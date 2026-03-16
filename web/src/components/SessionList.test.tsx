import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionList } from './SessionList'

vi.mock('@/hooks/useLongPress', () => ({
    useLongPress: () => ({})
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        haptic: {
            impact: vi.fn(),
            notification: vi.fn(),
            selection: vi.fn()
        }
    })
}))

vi.mock('@/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({
        archiveSession: vi.fn(),
        renameSession: vi.fn(),
        deleteSession: vi.fn(),
        isPending: false
    })
}))

vi.mock('@/components/SessionActionMenu', () => ({
    SessionActionMenu: () => null
}))

vi.mock('@/components/RenameSessionDialog', () => ({
    RenameSessionDialog: () => null
}))

vi.mock('@/components/ui/ConfirmDialog', () => ({
    ConfirmDialog: () => null
}))

afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

function renderWithProviders(ui: React.ReactElement) {
    localStorage.setItem('hapi-lang', 'zh-CN')
    return render(
        <I18nProvider>
            {ui}
        </I18nProvider>
    )
}

function createSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id: 'session-1',
        active: true,
        thinking: false,
        createdAt: 1,
        activeAt: 2,
        updatedAt: 2,
        metadata: {
            path: '/tmp/project',
            flavor: 'codex',
            source: 'native',
            nativeProvider: 'codex',
            nativeSessionId: '019cf0eb-e725-7580-8eae-d6daf495d6f1'
        },
        todoProgress: null,
        pendingRequestsCount: 0,
        ...overrides
    }
}

describe('SessionList', () => {
    it('prefers metadata.name over generated summary title and fallbacks', () => {
        renderWithProviders(
            <SessionList
                sessions={[createSession({
                    metadata: {
                        path: '/tmp/list-name-fallback',
                        name: 'Pinned Session',
                        summary: {
                            text: 'Generated Session'
                        },
                        flavor: 'codex',
                        source: 'native',
                        nativeProvider: 'codex',
                        nativeSessionId: '019cf0eb-e725-7580-8eae-d6daf495d6f1'
                    }
                })]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        expect(screen.getByText('Pinned Session')).toBeInTheDocument()
        expect(screen.queryByText('Generated Session')).not.toBeInTheDocument()
        expect(screen.queryByText('codex 019cf0eb')).not.toBeInTheDocument()
    })

    it('uses generated summary title before native short-id fallback', () => {
        renderWithProviders(
            <SessionList
                sessions={[createSession({
                    metadata: {
                        path: '/tmp/list-summary-fallback',
                        summary: {
                            text: 'Generated Session'
                        },
                        flavor: 'codex',
                        source: 'native',
                        nativeProvider: 'codex',
                        nativeSessionId: '019cf0eb-e725-7580-8eae-d6daf495d6f1'
                    }
                })]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        expect(screen.getByText('Generated Session')).toBeInTheDocument()
        expect(screen.queryByText('codex 019cf0eb')).not.toBeInTheDocument()
    })

    it.each(['native', 'hybrid'] as const)(
        'shows native provider and short native session id for %s sessions',
        (source) => {
            renderWithProviders(
                <SessionList
                    sessions={[createSession({
                        metadata: {
                            path: '/tmp/project',
                            flavor: 'codex',
                            source,
                            nativeProvider: 'codex',
                            nativeSessionId: '019cf0eb-e725-7580-8eae-d6daf495d6f1'
                        }
                    })]}
                    onSelect={vi.fn()}
                    onNewSession={vi.fn()}
                    onRefresh={vi.fn()}
                    isLoading={false}
                    renderHeader={false}
                    api={null}
                />
            )

            expect(screen.getByText('codex 019cf0eb')).toBeInTheDocument()
        }
    )

    it('falls back to the shared path-based title when native fallback is unavailable', () => {
        renderWithProviders(
            <SessionList
                sessions={[createSession({
                    metadata: {
                        path: '/tmp/list-path-fallback-title',
                        flavor: 'codex',
                        source: 'hapi'
                    }
                })]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        expect(screen.getByText('list-path-fallback-title')).toBeInTheDocument()
    })

    it('shows created and updated relative times together', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

        renderWithProviders(
            <SessionList
                sessions={[createSession({
                    createdAt: Date.parse('2026-03-15T10:00:00.000Z'),
                    updatedAt: Date.parse('2026-03-15T11:00:00.000Z')
                })]}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        expect(screen.getByText('创建 2 小时前 · 更新 1 小时前')).toBeInTheDocument()
    })

    it('filters sessions by selected agent tab', () => {
        renderWithProviders(
            <SessionList
                sessions={[
                    createSession({
                        id: 'session-claude',
                        metadata: {
                            path: '/tmp/project',
                            name: 'Claude Session',
                            flavor: 'claude',
                            source: 'native',
                            nativeProvider: 'claude',
                            nativeSessionId: 'claude-session-id'
                        }
                    }),
                    createSession({
                        id: 'session-codex',
                        metadata: {
                            path: '/tmp/project',
                            name: 'Codex Session',
                            flavor: 'codex',
                            source: 'native',
                            nativeProvider: 'codex',
                            nativeSessionId: 'codex-session-id'
                        }
                    })
                ]}
                agentTab="codex"
                onAgentTabChange={vi.fn()}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        expect(screen.getByRole('tablist', { name: '会话类型' })).toHaveClass('scrollbar-hidden')
        expect(screen.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByText('Codex Session')).toBeInTheDocument()
        expect(screen.queryByText('Claude Session')).not.toBeInTheDocument()
    })

    it('emits agent tab changes', () => {
        const onAgentTabChange = vi.fn()

        renderWithProviders(
            <SessionList
                sessions={[createSession()]}
                agentTab="codex"
                onAgentTabChange={onAgentTabChange}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        const codexTab = screen.getByRole('tab', { name: 'Codex' })

        expect(codexTab).not.toHaveClass('text-white')
        expect(codexTab).toHaveClass('text-[var(--app-button-text)]')

        fireEvent.click(codexTab)

        expect(onAgentTabChange).toHaveBeenCalledWith('codex')
    })

    it('remounts the list content when filtered sessions change for transition animation', () => {
        const sessions = [
            createSession({
                id: 'session-claude',
                metadata: {
                    path: '/tmp/project',
                    name: 'Claude Session',
                    flavor: 'claude',
                    source: 'native',
                    nativeProvider: 'claude',
                    nativeSessionId: 'claude-session-id'
                }
            }),
            createSession({
                id: 'session-codex',
                metadata: {
                    path: '/tmp/project',
                    name: 'Codex Session',
                    flavor: 'codex',
                    source: 'native',
                    nativeProvider: 'codex',
                    nativeSessionId: 'codex-session-id'
                }
            })
        ]

        const view = renderWithProviders(
            <SessionList
                sessions={sessions}
                agentTab="all"
                onAgentTabChange={vi.fn()}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        const before = screen.getByTestId('session-list-content')
        expect(before).toHaveClass('animate-session-list-swap')

        view.rerender(
            <I18nProvider>
                <SessionList
                    sessions={sessions}
                    agentTab="codex"
                    onAgentTabChange={vi.fn()}
                    onSelect={vi.fn()}
                    onNewSession={vi.fn()}
                    onRefresh={vi.fn()}
                    isLoading={false}
                    renderHeader={false}
                    api={null}
                />
            </I18nProvider>
        )

        const after = screen.getByTestId('session-list-content')
        expect(after).toHaveClass('animate-session-list-swap')
        expect(after).not.toBe(before)
    })
})
