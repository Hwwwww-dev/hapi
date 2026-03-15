import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import { DirectoryPickerDialog } from './DirectoryPickerDialog'

type FakeApi = {
    listMachineDirectory: ReturnType<typeof vi.fn>
    createMachineDirectory: ReturnType<typeof vi.fn>
}

function createApi(): FakeApi {
    return {
        listMachineDirectory: vi.fn(async (_machineId: string, path: string) => {
            if (path === '/Users/demo') {
                return {
                    success: true,
                    entries: [
                        { name: 'projects', type: 'directory' as const },
                        { name: 'notes.txt', type: 'file' as const }
                    ]
                }
            }

            if (path === '/Users/demo/projects') {
                return {
                    success: true,
                    entries: [
                        { name: 'alpha', type: 'directory' as const }
                    ]
                }
            }

            if (path === '/Users/demo/projects/new-child') {
                return { success: true, entries: [] }
            }

            if (path === 'C:\\Users\\demo') {
                return {
                    success: true,
                    entries: [{ name: 'code', type: 'directory' as const }]
                }
            }

            if (path === 'C:\\Users') {
                return {
                    success: true,
                    entries: [{ name: 'demo', type: 'directory' as const }]
                }
            }

            return { success: true, entries: [] }
        }),
        createMachineDirectory: vi.fn(async (_machineId: string, parentPath: string, name: string) => ({
            success: true,
            path: `${parentPath}/${name}`
        }))
    }
}

function renderDialog(ui: React.ReactElement) {
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

describe('DirectoryPickerDialog', () => {
    afterEach(() => {
        cleanup()
    })

    beforeEach(() => {
        vi.clearAllMocks()
        const localStorageMock = {
            getItem: vi.fn(() => 'zh-CN'),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        }
        Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })
    })

    it('starts at the provided home directory and only shows directories', async () => {
        const api = createApi()
        const onSelect = vi.fn()

        renderDialog(
            <DirectoryPickerDialog
                api={api as never}
                machineId="machine-1"
                machinePlatform="darwin"
                initialPath="/Users/demo"
                open={true}
                onOpenChange={vi.fn()}
                onSelect={onSelect}
            />
        )

        expect(await screen.findByText('/Users/demo')).toBeInTheDocument()
        expect(await screen.findByRole('button', { name: 'projects' })).toBeInTheDocument()
        expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: '选择当前目录' }))
        expect(onSelect).toHaveBeenCalledWith('/Users/demo')
    })

    it('navigates into child directories and creates a child directory immediately', async () => {
        const api = createApi()

        renderDialog(
            <DirectoryPickerDialog
                api={api as never}
                machineId="machine-1"
                machinePlatform="darwin"
                initialPath="/Users/demo"
                open={true}
                onOpenChange={vi.fn()}
                onSelect={vi.fn()}
            />
        )

        fireEvent.click(await screen.findByRole('button', { name: 'projects' }))
        expect(await screen.findByText('/Users/demo/projects')).toBeInTheDocument()

        fireEvent.change(screen.getByLabelText('新建目录名'), { target: { value: 'new-child' } })
        fireEvent.click(screen.getByRole('button', { name: '新建并进入' }))

        await waitFor(() => {
            expect(api.createMachineDirectory).toHaveBeenCalledWith('machine-1', '/Users/demo/projects', 'new-child')
        })
        expect(await screen.findByText('/Users/demo/projects/new-child')).toBeInTheDocument()
    })

    it('uses Windows parent navigation rules', async () => {
        const api = createApi()

        renderDialog(
            <DirectoryPickerDialog
                api={api as never}
                machineId="machine-1"
                machinePlatform="win32"
                initialPath={'C:\\Users\\demo'}
                open={true}
                onOpenChange={vi.fn()}
                onSelect={vi.fn()}
            />
        )

        expect(await screen.findByText('C:\\Users\\demo')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: '上一级' }))
        expect(await screen.findByText('C:\\Users')).toBeInTheDocument()
    })

    it('shows stable browse errors from structured HTTP responses', async () => {
        const api = {
            listMachineDirectory: vi.fn(async () => {
                throw new Error('HTTP 503 Service Unavailable: {"success":false,"error":"Machine directory browse unavailable"}')
            }),
            createMachineDirectory: vi.fn()
        }

        renderDialog(
            <DirectoryPickerDialog
                api={api as never}
                machineId="machine-1"
                machinePlatform="darwin"
                initialPath="/Users/demo"
                open={true}
                onOpenChange={vi.fn()}
                onSelect={vi.fn()}
            />
        )

        expect(await screen.findByText('Machine directory browse unavailable')).toBeInTheDocument()
    })
})
