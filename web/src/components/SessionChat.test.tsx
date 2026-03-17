import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { canonicalRootsToRenderBlocks } from '@/chat/canonical'
import type { CanonicalRootBlock, Session } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionChat } from './SessionChat'

const abortSessionMock = vi.fn(async () => undefined)
const archiveSessionMock = vi.fn(async () => undefined)
const switchSessionMock = vi.fn(async () => undefined)
const setPermissionModeMock = vi.fn(async () => undefined)
const setModelModeMock = vi.fn(async () => undefined)
const useHappyRuntimeMock = vi.fn((_args?: unknown) => ({}))

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
    SessionHeader: ({ session, onRefreshAction, onConnectionToggle }: {
        session: Session
        onRefreshAction?: () => void
        onConnectionToggle?: () => void
    }) => (
        <div>
            {onConnectionToggle ? (
                <button type="button" onClick={() => onConnectionToggle()}>
                    {session.active ? '取消连接' : '连接'}
                </button>
            ) : null}
            {onRefreshAction ? (
                <button type="button" onClick={() => onRefreshAction()}>
                    刷新
                </button>
            ) : null}
        </div>
    )
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
    useHappyRuntime: (args: unknown) => useHappyRuntimeMock(args)
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
        onBlocks: vi.fn(),
        onReady: vi.fn(),
        onPermissionRequested: vi.fn()
    }
}))

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

function createCanonicalRoot(overrides: Partial<CanonicalRootBlock> = {}): CanonicalRootBlock {
    const id = overrides.id ?? 'root-1'
    return {
        id,
        sessionId: overrides.sessionId ?? 'session-1',
        timelineSeq: overrides.timelineSeq ?? 1,
        siblingSeq: overrides.siblingSeq ?? 0,
        parentBlockId: null,
        rootBlockId: overrides.rootBlockId ?? id,
        depth: 0,
        kind: overrides.kind ?? 'agent-text',
        createdAt: overrides.createdAt ?? 1,
        updatedAt: overrides.updatedAt ?? 1,
        state: overrides.state ?? 'completed',
        payload: overrides.payload ?? { text: 'hello canonical' },
        sourceRawEventIds: overrides.sourceRawEventIds ?? ['raw-1'],
        parserVersion: overrides.parserVersion ?? 1,
        generation: overrides.generation ?? 1,
        children: overrides.children ?? []
    }
}

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

function renderChat(
    session: Session,
    apiOverrides: Record<string, unknown> = {},
    canonicalItems: CanonicalRootBlock[] = [],
    renderBlocks: any[] = []
) {
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
                canonicalItems={canonicalItems}
                renderBlocks={renderBlocks}
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
                    canonicalItems={[]}
                    renderBlocks={[]}
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

    it('renders from canonical-only render blocks instead of legacy message props', () => {
        const canonicalItems = [
            createCanonicalRoot({
                id: 'canonical-user-1',
                kind: 'user-text',
                createdAt: 1,
                payload: { text: 'canonical hello' }
            }),
            createCanonicalRoot({
                id: 'canonical-fallback-1',
                kind: 'fallback-raw',
                createdAt: 2,
                payload: {
                    provider: 'codex',
                    rawType: 'unknown_payload',
                    summary: 'unsupported raw event',
                    preview: { hello: 'world' }
                }
            })
        ]

        renderChat(
            createSession({ active: true }),
            {},
            canonicalItems,
            canonicalRootsToRenderBlocks(canonicalItems)
        )

        expect(useHappyRuntimeMock).toHaveBeenCalled()
        const runtimeArgs = useHappyRuntimeMock.mock.calls.at(-1)?.[0] as unknown as { blocks: Array<{ id: string }> }
        expect(runtimeArgs.blocks.map((block) => block.id)).toEqual([
            'canonical-user-1',
            'canonical-fallback-1'
        ])
    })

    it('reports only new canonical render blocks to voice hooks', async () => {
        const initialCanonicalItems = [
            createCanonicalRoot({
                id: 'canonical-user-1',
                kind: 'user-text',
                createdAt: 1,
                payload: { text: 'first' }
            })
        ]

        const { rerender } = render(
            <I18nProvider>
                <SessionChat
                    api={{ resumeSession: vi.fn(async () => 'session-1') } as any}
                    session={createSession({ active: true })}
                    canonicalItems={initialCanonicalItems}
                    renderBlocks={canonicalRootsToRenderBlocks(initialCanonicalItems)}
                    messagesWarning={null}
                    hasMoreMessages={false}
                    isLoadingMessages={false}
                    isLoadingMoreMessages={false}
                    isSending={false}
                    pendingCount={0}
                    messagesVersion={1}
                    onBack={vi.fn()}
                    onRefresh={vi.fn()}
                    onLoadMore={vi.fn(async () => undefined)}
                    onSend={vi.fn()}
                    onFlushPending={vi.fn()}
                    onAtBottomChange={vi.fn()}
                />
            </I18nProvider>
        )

        vi.clearAllMocks()

        const nextCanonicalItems = [
            createCanonicalRoot({
                id: 'canonical-user-1',
                kind: 'user-text',
                createdAt: 1,
                payload: { text: 'first' }
            }),
            createCanonicalRoot({
                id: 'canonical-agent-2',
                kind: 'agent-text',
                createdAt: 2,
                payload: { text: 'second' }
            })
        ]

        rerender(
            <I18nProvider>
                <SessionChat
                    api={{ resumeSession: vi.fn(async () => 'session-1') } as any}
                    session={createSession({ active: true })}
                    canonicalItems={nextCanonicalItems}
                    renderBlocks={canonicalRootsToRenderBlocks(nextCanonicalItems)}
                    messagesWarning={null}
                    hasMoreMessages={false}
                    isLoadingMessages={false}
                    isLoadingMoreMessages={false}
                    isSending={false}
                    pendingCount={0}
                    messagesVersion={2}
                    onBack={vi.fn()}
                    onRefresh={vi.fn()}
                    onLoadMore={vi.fn(async () => undefined)}
                    onSend={vi.fn()}
                    onFlushPending={vi.fn()}
                    onAtBottomChange={vi.fn()}
                />
            </I18nProvider>
        )

        const { voiceHooks } = await import('@/realtime')
        expect(voiceHooks.onBlocks).toHaveBeenCalledTimes(1)
        expect(voiceHooks.onBlocks).toHaveBeenCalledWith(
            'session-1',
            expect.arrayContaining([
                expect.objectContaining({ id: 'canonical-agent-2', kind: 'agent-text' })
            ])
        )
    })
})
