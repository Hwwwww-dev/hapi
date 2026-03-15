import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

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

            expect(screen.getByText('codex · 019cf0eb')).toBeInTheDocument()
        }
    )

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
})
