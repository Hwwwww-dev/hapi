import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import type { ApiClient } from '@/api/client'
import { canonicalRootsToRenderBlocks } from '@/chat/canonical'
import type { AttachmentMetadata, CanonicalRootBlock, DecryptedMessage, ModelMode, PermissionMode, Session } from '@/types/api'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { HappyComposer } from '@/components/AssistantChat/HappyComposer'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { SessionHeader } from '@/components/SessionHeader'
import { TeamPanel } from '@/components/TeamPanel'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useTranslation } from '@/lib/use-translation'
import { useVoiceOptional } from '@/lib/voice-context'
import { RealtimeVoiceSession, registerSessionStore, registerVoiceHooksStore, voiceHooks } from '@/realtime'

const SESSION_CHAT_RENDERER_INSTANCE_ID = Date.now()

function extractUserText(message: DecryptedMessage): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record || record.role !== 'user') {
        return null
    }

    if (
        record.content
        && typeof record.content === 'object'
        && 'type' in record.content
        && (record.content as { type?: unknown }).type === 'text'
        && typeof (record.content as { text?: unknown }).text === 'string'
    ) {
        const text = (record.content as unknown as { text: string }).text.trim()
        return text.length > 0 ? text : null
    }

    return null
}

export function SessionChat(props: {
    api: ApiClient
    session: Session
    canonicalItems: CanonicalRootBlock[]
    messages: DecryptedMessage[]
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMessages: boolean
    isLoadingMoreMessages: boolean
    isSending: boolean
    pendingCount: number
    messagesVersion: number
    onBack: () => void
    onRefresh: () => void
    onLoadMore: () => Promise<unknown>
    onSend: (text: string, attachments?: AttachmentMetadata[]) => void
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    onRetryMessage?: (localId: string) => void
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
}) {
    const { t } = useTranslation()
    const { haptic } = usePlatform()
    const navigate = useNavigate()
    const sessionInactive = !props.session.active
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const legacyBlocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const [forceScrollToken, setForceScrollToken] = useState(0)
    const [statusActionPending, setStatusActionPending] = useState<'resume' | 'disconnect' | 'refresh' | null>(null)
    const agentFlavor = props.session.metadata?.flavor ?? null
    const { abortSession, archiveSession, switchSession, setPermissionMode, setModelMode } = useSessionActions(
        props.api,
        props.session.id,
        agentFlavor
    )

    // Voice assistant integration
    const voice = useVoiceOptional()

    // Register session store for voice client tools
    useEffect(() => {
        registerSessionStore({
            getSession: () => props.session as { agentState?: { requests?: Record<string, unknown> } } | null,
            sendMessage: (_sessionId: string, message: string) => props.onSend(message),
            approvePermission: async (_sessionId: string, requestId: string) => {
                await props.api.approvePermission(props.session.id, requestId)
                props.onRefresh()
            },
            denyPermission: async (_sessionId: string, requestId: string) => {
                await props.api.denyPermission(props.session.id, requestId)
                props.onRefresh()
            }
        })
    }, [props.session, props.api, props.onSend, props.onRefresh])

    useEffect(() => {
        registerVoiceHooksStore(
            (sessionId) => (sessionId === props.session.id ? props.session : null),
            (sessionId) => (sessionId === props.session.id ? props.messages : [])
        )
    }, [props.session, props.messages])

    const prevMessagesRef = useRef<DecryptedMessage[]>([])

    useEffect(() => {
        const prevIds = new Set(prevMessagesRef.current.map(m => m.id))
        const newMessages = props.messages.filter(m => !prevIds.has(m.id))

        if (newMessages.length > 0) {
            voiceHooks.onMessages(props.session.id, newMessages)
        }

        prevMessagesRef.current = props.messages
    }, [props.messages, props.session.id])

    const prevThinkingRef = useRef(props.session.thinking)

    useEffect(() => {
        // Detect transition: thinking → not thinking
        if (prevThinkingRef.current && !props.session.thinking) {
            voiceHooks.onReady(props.session.id)
        }

        prevThinkingRef.current = props.session.thinking
    }, [props.session.thinking, props.session.id])

    const prevRequestIdsRef = useRef<Set<string>>(new Set())
    const rendererInstanceIdRef = useRef(SESSION_CHAT_RENDERER_INSTANCE_ID)

    if (rendererInstanceIdRef.current !== SESSION_CHAT_RENDERER_INSTANCE_ID) {
        normalizedCacheRef.current.clear()
        legacyBlocksByIdRef.current.clear()
        prevMessagesRef.current = []
        prevRequestIdsRef.current = new Set()
        prevThinkingRef.current = props.session.thinking
        rendererInstanceIdRef.current = SESSION_CHAT_RENDERER_INSTANCE_ID
    }

    useEffect(() => {
        const requests = props.session.agentState?.requests ?? {}
        const currentIds = new Set(Object.keys(requests))

        for (const [requestId, request] of Object.entries(requests)) {
            if (!prevRequestIdsRef.current.has(requestId)) {
                voiceHooks.onPermissionRequested(
                    props.session.id,
                    requestId,
                    (request as { tool?: string }).tool ?? 'unknown',
                    (request as { arguments?: unknown }).arguments
                )
            }
        }

        prevRequestIdsRef.current = currentIds
    }, [props.session.agentState?.requests, props.session.id])

    const handleVoiceToggle = useCallback(async () => {
        if (!voice) return
        if (voice.status === 'connected' || voice.status === 'connecting') {
            await voice.stopVoice()
        } else {
            await voice.startVoice(props.session.id)
        }
    }, [voice, props.session.id])

    const handleVoiceMicToggle = useCallback(() => {
        if (!voice) return
        voice.toggleMic()
    }, [voice])

    // Track session id to clear caches when it changes
    const prevSessionIdRef = useRef<string | null>(null)

    useEffect(() => {
        normalizedCacheRef.current.clear()
        legacyBlocksByIdRef.current.clear()
    }, [props.session.id])

    const normalizedMessages: NormalizedMessage[] = useMemo(() => {
        // Clear caches immediately when session changes (before useEffect runs)
        if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== props.session.id) {
            normalizedCacheRef.current.clear()
            legacyBlocksByIdRef.current.clear()
        }
        prevSessionIdRef.current = props.session.id

        const cache = normalizedCacheRef.current
        const normalized: NormalizedMessage[] = []
        const seen = new Set<string>()
        for (const message of props.messages) {
            seen.add(message.id)
            const cached = cache.get(message.id)
            if (cached && cached.source === message) {
                if (cached.normalized) normalized.push(cached.normalized)
                continue
            }
            const next = normalizeDecryptedMessage(message)
            cache.set(message.id, { source: message, normalized: next })
            if (next) normalized.push(next)
        }
        for (const id of cache.keys()) {
            if (!seen.has(id)) {
                cache.delete(id)
            }
        }
        return normalized
    }, [props.messages])

    const reduced = useMemo(
        () => reduceChatBlocks(normalizedMessages, props.session.agentState),
        [normalizedMessages, props.session.agentState]
    )

    const canonicalBlocks = useMemo(
        () => canonicalRootsToRenderBlocks(props.canonicalItems),
        [props.canonicalItems]
    )

    const canonicalRootIds = useMemo(
        () => new Set(props.canonicalItems.map((item) => item.id)),
        [props.canonicalItems]
    )

    const canonicalUserEntries = useMemo(() => {
        return props.canonicalItems
            .filter((item) => item.kind === 'user-text')
            .map((item) => ({
                createdAt: item.createdAt,
                text: typeof item.payload?.text === 'string' ? item.payload.text.trim() : ''
            }))
            .filter((entry) => entry.text.length > 0)
    }, [props.canonicalItems])

    const overlayMessages = useMemo(() => {
        return props.messages.filter((message) => {
            if (canonicalRootIds.has(message.id)) {
                return false
            }

            const userText = extractUserText(message)
            if (!userText) {
                return true
            }

            return !canonicalUserEntries.some((entry) =>
                entry.text === userText && Math.abs(entry.createdAt - message.createdAt) < 10_000
            )
        })
    }, [canonicalRootIds, canonicalUserEntries, props.messages])

    const normalizedOverlayMessages = useMemo(() => {
        const overlayIds = new Set(overlayMessages.map((message) => message.id))
        return normalizedMessages.filter((message) => overlayIds.has(message.id))
    }, [normalizedMessages, overlayMessages])

    const reducedOverlay = useMemo(
        () => reduceChatBlocks(normalizedOverlayMessages, null),
        [normalizedOverlayMessages]
    )
    const reconciledOverlay = useMemo(
        () => reconcileChatBlocks(reducedOverlay.blocks, legacyBlocksByIdRef.current),
        [reducedOverlay.blocks]
    )

    useEffect(() => {
        legacyBlocksByIdRef.current = reconciledOverlay.byId
    }, [reconciledOverlay.byId])

    const runtimeBlocks = useMemo(() => {
        const combined = [...canonicalBlocks, ...reconciledOverlay.blocks]
        return combined.sort((left, right) => {
            if (left.createdAt !== right.createdAt) {
                return left.createdAt - right.createdAt
            }
            return left.id.localeCompare(right.id)
        })
    }, [canonicalBlocks, reconciledOverlay.blocks])

    // Permission mode change handler
    const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
        try {
            await setPermissionMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set permission mode:', e)
        }
    }, [setPermissionMode, props.onRefresh, haptic])

    // Model mode change handler
    const handleModelModeChange = useCallback(async (mode: ModelMode) => {
        try {
            await setModelMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set model mode:', e)
        }
    }, [setModelMode, props.onRefresh, haptic])

    // Abort handler
    const handleAbort = useCallback(async () => {
        await abortSession()
        props.onRefresh()
    }, [abortSession, props.onRefresh])

    // Switch to remote handler
    const handleSwitchToRemote = useCallback(async () => {
        await switchSession()
        props.onRefresh()
    }, [switchSession, props.onRefresh])

    const handleViewFiles = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleViewTerminal = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/terminal',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleSend = useCallback((text: string, attachments?: AttachmentMetadata[]) => {
        props.onSend(text, attachments)
        setForceScrollToken((token) => token + 1)
    }, [props.onSend])

    const handleResume = useCallback(async () => {
        try {
            setStatusActionPending('resume')
            await props.api.resumeSession(props.session.id)
            props.onRefresh()
        } catch (error) {
            console.error('Failed to resume session:', error)
        } finally {
            setStatusActionPending(null)
        }
    }, [props.api, props.onRefresh, props.session.id])

    const handleRefresh = useCallback(async () => {
        try {
            setStatusActionPending('refresh')
            await props.onRefresh()
        } finally {
            setStatusActionPending(null)
        }
    }, [props.onRefresh])

    const handleDisconnect = useCallback(async () => {
        try {
            setStatusActionPending('disconnect')
            await archiveSession()
            props.onRefresh()
        } catch (error) {
            console.error('Failed to disconnect session:', error)
        } finally {
            setStatusActionPending(null)
        }
    }, [archiveSession, props.onRefresh])

    const handleConnectionToggle = useCallback(() => {
        if (sessionInactive) {
            void handleResume()
            return
        }
        void handleDisconnect()
    }, [handleDisconnect, handleResume, sessionInactive])

    const attachmentAdapter = useMemo(() => {
        if (!props.session.active) {
            return undefined
        }
        return createAttachmentAdapter(props.api, props.session.id)
    }, [props.api, props.session.id, props.session.active])

    const runtime = useHappyRuntime({
        session: props.session,
        blocks: runtimeBlocks,
        isSending: props.isSending,
        onSendMessage: handleSend,
        onAbort: handleAbort,
        attachmentAdapter,
        allowSendWhenInactive: true
    })

    return (
        <div className="flex h-full flex-col">
            <SessionHeader
                session={props.session}
                onBack={props.onBack}
                onViewFiles={props.session.metadata?.path ? handleViewFiles : undefined}
                api={props.api}
                onSessionDeleted={props.onBack}
                onRefreshAction={() => { void handleRefresh() }}
                onConnectionToggle={handleConnectionToggle}
                statusActionPending={statusActionPending !== null}
            />

            {props.session.teamState && (
                <TeamPanel teamState={props.session.teamState} />
            )}

            {sessionInactive ? (
                <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)]">
                    <div className="mx-auto w-full max-w-content px-3 py-2 text-xs text-[var(--app-hint)]">
                        {t('session.chat.inactive')}
                    </div>
                </div>
            ) : null}

            <AssistantRuntimeProvider runtime={runtime}>
                <div className="relative flex min-h-0 flex-1 flex-col">
                    <HappyThread
                        key={props.session.id}
                        api={props.api}
                        sessionId={props.session.id}
                        metadata={props.session.metadata}
                        disabled={sessionInactive}
                        onRefresh={props.onRefresh}
                        onRetryMessage={props.onRetryMessage}
                        onFlushPending={props.onFlushPending}
                        onAtBottomChange={props.onAtBottomChange}
                        isLoadingMessages={props.isLoadingMessages}
                        messagesWarning={props.messagesWarning}
                        hasMoreMessages={props.hasMoreMessages}
                        isLoadingMoreMessages={props.isLoadingMoreMessages}
                        onLoadMore={props.onLoadMore}
                        pendingCount={props.pendingCount}
                        rawMessagesCount={props.messages.length}
                        normalizedMessagesCount={runtimeBlocks.length}
                        messagesVersion={props.messagesVersion}
                        forceScrollToken={forceScrollToken}
                    />

                    <HappyComposer
                        disabled={props.isSending}
                        permissionMode={props.session.permissionMode}
                        modelMode={props.session.modelMode}
                        agentFlavor={agentFlavor}
                        active={props.session.active}
                        allowSendWhenInactive
                        thinking={props.session.thinking}
                        agentState={props.session.agentState}
                        contextSize={reduced.latestUsage?.contextSize}
                        controlledByUser={props.session.agentState?.controlledByUser === true}
                        onPermissionModeChange={handlePermissionModeChange}
                        onModelModeChange={handleModelModeChange}
                        onSwitchToRemote={handleSwitchToRemote}
                        onTerminal={props.session.active ? handleViewTerminal : undefined}
                        autocompleteSuggestions={props.autocompleteSuggestions}
                        voiceStatus={voice?.status}
                        voiceMicMuted={voice?.micMuted}
                        onVoiceToggle={voice ? handleVoiceToggle : undefined}
                        onVoiceMicToggle={voice ? handleVoiceMicToggle : undefined}
                    />
                </div>
            </AssistantRuntimeProvider>

            {/* Voice session component - renders nothing but initializes ElevenLabs */}
            {voice && (
                <RealtimeVoiceSession
                    api={props.api}
                    micMuted={voice.micMuted}
                    onStatusChange={voice.setStatus}
                />
            )}
        </div>
    )
}
