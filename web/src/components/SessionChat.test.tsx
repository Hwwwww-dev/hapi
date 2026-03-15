import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { Session } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionChat } from './SessionChat'

const abortSessionMock = vi.fn(async () => undefined)
const archiveSessionMock = vi.fn(async () => undefined)
const switchSessionMock = vi.fn(async () => undefined)
const setPermissionModeMock = vi.fn(async () => undefined)
const setModelModeMock = vi.fn(async () => undefined)

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn()
}))

vi.mock('@assistant-ui/react', () => ({
    AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@/components/AssistantChat/HappyComposer', () => ({
    HappyComposer: () => null
}))

vi.mock('@/components/AssistantChat/HappyThread', () => ({
    HappyThread: () => null
}))

vi.mock('@/components/SessionHeader', () => ({
    SessionHeader: () => null
}))

vi.mock('@/components/TeamPanel', () => ({
    TeamPanel: () => null
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
        abortSession: abortSessionMock,
        archiveSession: archiveSessionMock,
        switchSession: switchSessionMock,
        setPermissionMode: setPermissionModeMock,
        setModelMode: setModelModeMock
    })
}))

vi.mock('@/lib/assistant-runtime', () => ({
    useHappyRuntime: () => ({})
}))

vi.mock('@/lib/attachmentAdapter', () => ({
    createAttachmentAdapter: () => ({})
}))

vi.mock('@/lib/voice-context', () => ({
    useVoiceOptional: () => null
}))

vi.mock('@/realtime', () => ({
    RealtimeVoiceSession: () => null,
    registerSessionStore: vi.fn(),
    registerVoiceHooksStore: vi.fn(),
    voiceHooks: {
        onMessages: vi.fn(),
        onReady: vi.fn(),
        onPermissionRequested: vi.fn()
    }
}))

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 2,
        active: false,
        activeAt: 2,
        metadata: {
            path: '/tmp/project',
            host: 'local',
            flavor: 'codex'
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        ...overrides
    }
}

function renderChat(session: Session, apiOverrides: Record<string, unknown> = {}) {
    const api = {
        resumeSession: vi.fn(async () => session.id),
        ...apiOverrides
    } as any

    localStorage.setItem('hapi-lang', 'zh-CN')
    render(
        <I18nProvider>
            <SessionChat
                api={api}
                session={session}
                messages={[]}
                messagesWarning={null}
                hasMoreMessages={false}
                isLoadingMessages={false}
                isLoadingMoreMessages={false}
                isSending={false}
                pendingCount={0}
                messagesVersion={0}
                onBack={vi.fn()}
                onRefresh={vi.fn()}
                onLoadMore={vi.fn(async () => undefined)}
                onSend={vi.fn()}
                onFlushPending={vi.fn()}
                onAtBottomChange={vi.fn()}
            />
        </I18nProvider>
    )

    return { api }
}

describe('SessionChat connection controls', () => {
    it('shows inactive hint and lets users connect or refresh manually', async () => {
        const onRefresh = vi.fn()
        const session = createSession({ active: false })
        const api = {
            resumeSession: vi.fn(async () => session.id)
        } as any

        localStorage.setItem('hapi-lang', 'zh-CN')
        render(
            <I18nProvider>
                <SessionChat
                    api={api}
                    session={session}
                    messages={[]}
                    messagesWarning={null}
                    hasMoreMessages={false}
                    isLoadingMessages={false}
                    isLoadingMoreMessages={false}
                    isSending={false}
                    pendingCount={0}
                    messagesVersion={0}
                    onBack={vi.fn()}
                    onRefresh={onRefresh}
                    onLoadMore={vi.fn(async () => undefined)}
                    onSend={vi.fn()}
                    onFlushPending={vi.fn()}
                    onAtBottomChange={vi.fn()}
                />
            </I18nProvider>
        )

        expect(screen.getByText('会话当前未激活。发送消息会自动恢复连接。')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: '连接' }))
        await waitFor(() => expect(api.resumeSession).toHaveBeenCalledWith('session-1'))
        await waitFor(() => expect(onRefresh).toHaveBeenCalled())

        fireEvent.click(screen.getByRole('button', { name: '刷新' }))
        expect(onRefresh).toHaveBeenCalledTimes(2)
    })

    it('lets users disconnect an active session from the status actions', async () => {
        renderChat(createSession({ active: true }))

        fireEvent.click(screen.getByRole('button', { name: '取消连接' }))

        await waitFor(() => expect(archiveSessionMock).toHaveBeenCalled())
    })
})
