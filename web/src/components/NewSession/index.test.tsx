import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import { NewSession } from './index'

function createApi() {
    return {
        getSessions: vi.fn(async () => ({ groups: [] })),
        checkMachinePathsExists: vi.fn(async (_machineId: string, paths: string[]) => ({
            exists: Object.fromEntries(paths.map((path) => [path, path === '/Users/demo/projects']))
        })),
        spawnSession: vi.fn(async () => ({ type: 'success' as const, sessionId: 'session-1' })),
        listMachineDirectory: vi.fn(async (_machineId: string, path: string) => {
            if (path === '/Users/demo') {
                return {
                    success: true,
                    entries: [{ name: 'projects', type: 'directory' as const }]
                }
            }

            if (path === '/Users/demo/projects') {
                return { success: true, entries: [] }
            }

            return { success: true, entries: [] }
        }),
        createMachineDirectory: vi.fn(async (_machineId: string, parentPath: string, name: string) => ({
            success: true,
            path: `${parentPath}/${name}`
        }))
    }
}

function renderWithProviders(ui: React.ReactElement) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    })

    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                {ui}
            </I18nProvider>
        </QueryClientProvider>
    )
}

describe('NewSession', () => {
    afterEach(() => {
        cleanup()
    })

    beforeEach(() => {
        vi.clearAllMocks()
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: vi.fn(() => ({
                matches: false,
                media: '',
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn()
            }))
        })
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: vi.fn((key: string) => key === 'hapi-lang' ? 'zh-CN' : null),
                setItem: vi.fn(),
                removeItem: vi.fn()
            }
        })
        Object.defineProperty(navigator, 'vibrate', {
            configurable: true,
            value: vi.fn()
        })
    })

    it('writes the selected directory back into the input', async () => {
        const api = createApi()

        renderWithProviders(
            <NewSession
                api={api as never}
                machines={[{
                    id: 'machine-1',
                    active: true,
                    metadata: {
                        host: 'demo-host',
                        platform: 'darwin',
                        happyCliVersion: '0.1.0',
                        homeDir: '/Users/demo'
                    }
                }]}
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        fireEvent.click(await screen.findByRole('button', { name: '浏览' }))
        fireEvent.click(await screen.findByRole('button', { name: 'projects' }))
        fireEvent.click(screen.getByRole('button', { name: '选择当前目录' }))

        expect(await screen.findByDisplayValue('/Users/demo/projects')).toBeInTheDocument()
    })

    it('warns before creating a simple session in a missing directory and confirms on second click', async () => {
        const api = createApi()
        const onSuccess = vi.fn()

        renderWithProviders(
            <NewSession
                api={api as never}
                machines={[{
                    id: 'machine-1',
                    active: true,
                    metadata: {
                        host: 'demo-host',
                        platform: 'darwin',
                        happyCliVersion: '0.1.0',
                        homeDir: '/Users/demo'
                    }
                }]}
                onSuccess={onSuccess}
                onCancel={vi.fn()}
            />
        )

        fireEvent.change(await screen.findByPlaceholderText('/path/to/project'), {
            target: { value: '/Users/demo/missing' }
        })

        await waitFor(() => {
            expect(screen.getByText('目录不存在，将在创建会话时一并创建。')).toBeInTheDocument()
        })

        const createButton = screen.getByRole('button', { name: '创建' })
        expect(createButton).toBeEnabled()

        fireEvent.click(createButton)

        await waitFor(() => {
            expect(screen.getByText('再次点击将创建目录并启动会话。')).toBeInTheDocument()
        })
        expect(screen.getByRole('button', { name: '创建并创建目录' })).toBeEnabled()
        expect(api.spawnSession).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: '创建并创建目录' }))

        await waitFor(() => {
            expect(api.spawnSession).toHaveBeenCalledWith(
                'machine-1',
                '/Users/demo/missing',
                'claude',
                undefined,
                undefined,
                false,
                'simple',
                undefined
            )
            expect(onSuccess).toHaveBeenCalledWith('session-1')
        })
    })

    it('still blocks worktree creation when the base directory does not exist', async () => {
        const api = createApi()

        renderWithProviders(
            <NewSession
                api={api as never}
                machines={[{
                    id: 'machine-1',
                    active: true,
                    metadata: {
                        host: 'demo-host',
                        platform: 'darwin',
                        happyCliVersion: '0.1.0',
                        homeDir: '/Users/demo'
                    }
                }]}
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        fireEvent.change(await screen.findByPlaceholderText('/path/to/project'), {
            target: { value: '/Users/demo/missing' }
        })
        fireEvent.click(screen.getByLabelText('工作树'))

        await waitFor(() => {
            expect(screen.getByText('工作树模式要求基目录必须已存在。')).toBeInTheDocument()
        })
        expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
    })

    it('passes codex reasoning effort with xhigh as the default', async () => {
        const api = createApi()
        const onSuccess = vi.fn()

        renderWithProviders(
            <NewSession
                api={api as never}
                machines={[{
                    id: 'machine-1',
                    active: true,
                    metadata: {
                        host: 'demo-host',
                        platform: 'darwin',
                        happyCliVersion: '0.1.0',
                        homeDir: '/Users/demo'
                    }
                }]}
                onSuccess={onSuccess}
                onCancel={vi.fn()}
            />
        )

        fireEvent.change(await screen.findByPlaceholderText('/path/to/project'), {
            target: { value: '/Users/demo/projects' }
        })
        fireEvent.click(screen.getByDisplayValue('codex'))
        const createButton = screen.getByRole('button', { name: '创建' })
        await waitFor(() => {
            expect(createButton).toBeEnabled()
        })

        fireEvent.click(createButton)

        await waitFor(() => {
            expect(api.spawnSession).toHaveBeenCalledWith(
                'machine-1',
                '/Users/demo/projects',
                'codex',
                undefined,
                'xhigh',
                false,
                'simple',
                undefined
            )
            expect(onSuccess).toHaveBeenCalledWith('session-1')
        })
    })

    it('clears stale path existence when switching machines', async () => {
        let resolveMachine2: ((value: { exists: Record<string, boolean> }) => void) | undefined
        const api = createApi()
        api.checkMachinePathsExists = vi.fn((machineId: string, paths: string[]) => {
            const exists = Object.fromEntries(paths.map((path) => [path, machineId === 'machine-1']))
            if (machineId === 'machine-2') {
                return new Promise((resolve) => {
                    resolveMachine2 = resolve
                })
            }
            return Promise.resolve({ exists })
        })

        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: vi.fn((key: string) => {
                    if (key === 'hapi-lang') return 'zh-CN'
                    if (key === 'hapi:lastMachineId') return 'machine-1'
                    if (key === 'hapi:recentPaths') {
                        return JSON.stringify({
                            'machine-1': ['/shared/project'],
                            'machine-2': ['/shared/project']
                        })
                    }
                    return null
                }),
                setItem: vi.fn(),
                removeItem: vi.fn()
            }
        })

        renderWithProviders(
            <NewSession
                api={api as never}
                machines={[
                    {
                        id: 'machine-1',
                        active: true,
                        metadata: {
                            host: 'alpha-host',
                            platform: 'darwin',
                            happyCliVersion: '0.1.0',
                            homeDir: '/Users/alpha'
                        }
                    },
                    {
                        id: 'machine-2',
                        active: true,
                        metadata: {
                            host: 'beta-host',
                            platform: 'darwin',
                            happyCliVersion: '0.1.0',
                            homeDir: '/Users/beta'
                        }
                    }
                ]}
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        const createButton = await screen.findByRole('button', { name: '创建' })
        await waitFor(() => {
            expect(createButton).toBeEnabled()
        })

        fireEvent.change(screen.getAllByRole('combobox')[0]!, {
            target: { value: 'machine-2' }
        })

        expect(createButton).toBeDisabled()

        resolveMachine2?.({ exists: { '/shared/project': false } })
        await waitFor(() => {
            expect(createButton).toBeEnabled()
            expect(screen.getByText('目录不存在，将在创建会话时一并创建。')).toBeInTheDocument()
        })
    })
})
