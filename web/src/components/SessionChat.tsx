import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { ApiClient } from '@/api/client'
import type {
    AttachmentMetadata,
    CodexCollaborationMode,
    DecryptedMessage,
    PermissionMode,
    Session,
    SlashCommand
} from '@/types/api'
import { isSidechainMessage } from '@/lib/messages'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { ChatProvider } from '@/chat/chat-context'
import { ComposerProvider, type ComposerContextValue } from '@/chat/composer-context'
import { useAttachmentManager } from '@/lib/useAttachmentManager'
import { HappyComposer } from '@/components/AssistantChat/HappyComposer'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import type { HappyThreadHandle } from '@/components/AssistantChat/HappyThread'
import { findUnsupportedCodexBuiltinSlashCommand } from '@/lib/codexSlashCommands'
import { useToast } from '@/lib/toast-context'
import { SessionHeader } from '@/components/SessionHeader'
import { TeamPanel } from '@/components/TeamPanel'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useTranslation } from '@/lib/use-translation'
import { useVoiceOptional } from '@/lib/voice-context'
import { RealtimeVoiceSession, registerSessionStore, registerVoiceHooksStore, voiceHooks } from '@/realtime'
import { ScrollToBottomButton } from '@/components/AssistantChat/ScrollToBottomButton'
import { isRemoteTerminalSupported } from '@/utils/terminalSupport'

const SESSION_CHAT_RENDERER_INSTANCE_ID = Date.now()

export const SessionChat = memo(function SessionChat(props: {
    api: ApiClient
    session: Session
    messages: DecryptedMessage[]
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMessages: boolean
    isLoadingMoreMessages: boolean
    isSending: boolean
    pendingCount: number
    totalMessages: number | null
    messagesVersion: number
    onBack: () => void
    onRefresh: () => void
    onLoadMore: () => Promise<unknown>
    onSend: (text: string, attachments?: AttachmentMetadata[]) => void
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    onRetryMessage?: (localId: string) => void
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    onSendQueued?: (text: string, attachments?: AttachmentMetadata[]) => Promise<void>
    sessionId?: string | null
    availableSlashCommands?: readonly SlashCommand[]
}) {
    const { t } = useTranslation()
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const navigate = useNavigate()
    const sessionInactive = !props.session.active
    const terminalSupported = isRemoteTerminalSupported(props.session.metadata)
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const [forceScrollToken, setForceScrollToken] = useState(0)
    const [atBottom, setAtBottom] = useState(true)
    const threadRef = useRef<HappyThreadHandle>(null)
    const [statusActionPending, setStatusActionPending] = useState<'resume' | 'disconnect' | 'refresh' | null>(null)
    const agentFlavor = props.session.metadata?.flavor ?? null
    const controlledByUser = props.session.agentState?.controlledByUser === true
    const isSubagent = !!props.session.metadata?.parentNativeSessionId
    const codexCollaborationModeSupported = agentFlavor === 'codex' && !controlledByUser
    const { abortSession, archiveSession, switchSession, setPermissionMode, setCollaborationMode, setModel, setModelReasoningEffort, setEffort } = useSessionActions(
        props.api,
        props.session.id,
        agentFlavor,
        codexCollaborationModeSupported
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
        blocksByIdRef.current.clear()
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

    // Clear normalization caches when session changes
    useEffect(() => {
        normalizedCacheRef.current.clear()
        blocksByIdRef.current.clear()
    }, [props.session.id])

    const normalizedMessages: NormalizedMessage[] = useMemo(() => {
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

    const rootMessageCount = useMemo(
        () => props.messages.filter(m => !isSidechainMessage(m)).length,
        [props.messages]
    )

    // Count NEW messages by seq — only counts messages arriving AFTER user scrolled away.
    // Uses raw messages (which have seq), then divides by 2 to approximate visible count
    // (each visible turn = assistant + tool_result = ~2 raw messages)
    const [seqSnapshot, setSeqSnapshot] = useState(0)

    const newMessageCount = useMemo(() => {
        if (seqSnapshot === 0) return 0
        let count = 0
        for (const m of props.messages) {
            if ((m.seq ?? 0) > seqSnapshot && !isSidechainMessage(m)) count++
        }
        // Approximate visible block count: tool calls produce ~2 raw messages per visible block
        return Math.max(0, Math.ceil(count / 2))
    }, [props.messages, seqSnapshot])

    const reduced = useMemo(
        () => reduceChatBlocks(normalizedMessages, props.session.agentState),
        [normalizedMessages, props.session.agentState]
    )
    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, blocksByIdRef.current),
        [reduced.blocks]
    )

    useEffect(() => {
        blocksByIdRef.current = reconciled.byId
    }, [reconciled.byId])

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

    const handleCollaborationModeChange = useCallback(async (mode: CodexCollaborationMode) => {
        try {
            await setCollaborationMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set collaboration mode:', e)
        }
    }, [setCollaborationMode, props.onRefresh, haptic])

    // Model mode change handler
    const handleModelChange = useCallback(async (model: string | null) => {
        try {
            await setModel(model)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set model:', e)
        }
    }, [setModel, props.onRefresh, haptic])

    const handleModelReasoningEffortChange = useCallback(async (modelReasoningEffort: string | null) => {
        try {
            await setModelReasoningEffort(modelReasoningEffort)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set model reasoning effort:', e)
        }
    }, [setModelReasoningEffort, props.onRefresh, haptic])

    const handleEffortChange = useCallback(async (effort: string | null) => {
        try {
            await setEffort(effort)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set effort:', e)
        }
    }, [setEffort, props.onRefresh, haptic])

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
            to: '/sessions/$sessionId/vcs',
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
        if (agentFlavor === 'codex') {
            const unsupportedCommand = findUnsupportedCodexBuiltinSlashCommand(
                text,
                props.availableSlashCommands ?? []
            )
            if (unsupportedCommand) {
                haptic.notification('error')
                addToast({
                    title: t('composer.codexSlashUnsupported.title'),
                    body: t('composer.codexSlashUnsupported.body', { command: `/${unsupportedCommand}` }),
                    sessionId: props.session.id,
                    url: `/sessions/${props.session.id}`
                })
                return
            }
        }

        props.onSend(text, attachments)
        setForceScrollToken((token) => token + 1)
    }, [agentFlavor, props.availableSlashCommands, props.onSend, props.session.id, addToast, haptic, t])

    const handleAtBottomChange = useCallback((value: boolean) => {
        if (!value) {
            // Capture maxSeq when scrolling away — loadMore'd old messages have lower seq, so won't be counted
            let maxSeq = 0
            for (const m of props.messages) {
                const s = m.seq ?? 0
                if (s > maxSeq) maxSeq = s
            }
            setSeqSnapshot(maxSeq)
        } else {
            setSeqSnapshot(0)
            props.onFlushPending()
        }
        setAtBottom(value)
        props.onAtBottomChange(value)
    }, [props.onAtBottomChange, props.onFlushPending, props.messages])

    const handleScrollToBottom = useCallback(() => {
        handleAtBottomChange(true)
        threadRef.current?.scrollToBottom()
    }, [handleAtBottomChange])

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

    // Attachment manager (replaces createAttachmentAdapter)
    const attachmentMgr = useAttachmentManager(props.api, props.session.id, props.session.active)

    // Composer text state
    const [composerText, setComposerText] = useState('')

    // Reset composer text on session change
    useEffect(() => {
        setComposerText('')
    }, [props.session.id])

    const composerCtxValue: ComposerContextValue = useMemo(() => ({
        text: composerText,
        setText: setComposerText,
        attachments: attachmentMgr.attachments,
        addAttachment: attachmentMgr.addAttachment,
        removeAttachment: attachmentMgr.removeAttachment,
        send: (text: string) => {
            const metadata = attachmentMgr.toMetadata()
            handleSend(text, metadata.length > 0 ? metadata : undefined)
            attachmentMgr.clear()
            setComposerText('')
        },
        cancelRun: handleAbort,
    }), [composerText, attachmentMgr, handleSend, handleAbort])

    const isRunning = props.session.thinking
    const isDisabled = props.isSending || !props.session.active

    return (
        <div className="flex h-full min-h-0 flex-col">
            <SessionHeader
                session={props.session}
                onBack={props.onBack}
                onViewFiles={props.session.metadata?.path ? handleViewFiles : undefined}
                api={props.api}
                onSessionDeleted={props.onBack}
                onRefreshAction={() => { void handleRefresh() }}
                onConnectionToggle={handleConnectionToggle}
                statusActionPending={statusActionPending !== null}
                readOnly={isSubagent}
            />

            {props.session.teamState && (
                <TeamPanel teamState={props.session.teamState} />
            )}

            <ChatProvider blocks={reconciled.blocks} isRunning={isRunning} isDisabled={isDisabled}>
            <ComposerProvider value={composerCtxValue}>
                <div className="relative flex min-h-0 flex-1 flex-col">
                    {sessionInactive ? (
                        <div className="absolute top-0 left-0 right-0 z-20 flex justify-center pointer-events-none">
                            <div className="mt-2 rounded-full bg-amber-100 dark:bg-amber-950 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-500 shadow-md pointer-events-auto animate-slide-down-fade">
                                {t('session.chat.inactive')}
                            </div>
                        </div>
                    ) : null}
                    <HappyThread
                        ref={threadRef}
                        key={props.session.id}
                        api={props.api}
                        sessionId={props.session.id}
                        metadata={props.session.metadata}
                        disabled={sessionInactive}
                        onRefresh={props.onRefresh}
                        onRetryMessage={props.onRetryMessage}
                        onFlushPending={props.onFlushPending}
                        onAtBottomChange={handleAtBottomChange}
                        isLoadingMessages={props.isLoadingMessages}
                        messagesWarning={props.messagesWarning}
                        hasMoreMessages={props.hasMoreMessages}
                        isLoadingMoreMessages={props.isLoadingMoreMessages}
                        onLoadMore={props.onLoadMore}
                        pendingCount={props.pendingCount}
                        rawMessagesCount={props.messages.length}
                        normalizedMessagesCount={normalizedMessages.length}
                        messagesVersion={props.messagesVersion}
                        forceScrollToken={forceScrollToken}
                    />

                    {!isSubagent && (
                    <div className="relative shrink-0">
                    <ScrollToBottomButton visible={!atBottom} count={newMessageCount + props.pendingCount} onClick={handleScrollToBottom} />
                    <HappyComposer
                        key={props.session.id}
                        sessionId={props.session.id}
                        disabled={props.isSending}
                        permissionMode={props.session.permissionMode}
                        collaborationMode={codexCollaborationModeSupported ? props.session.collaborationMode : undefined}
                        model={props.session.model}
                        modelReasoningEffort={agentFlavor === 'codex' ? props.session.modelReasoningEffort : undefined}
                        effort={props.session.effort}
                        agentFlavor={agentFlavor}
                        active={props.session.active}
                        allowSendWhenInactive
                        thinking={props.session.thinking}
                        agentState={props.session.agentState}
                        backgroundTaskCount={props.session.backgroundTaskCount}
                        contextSize={reduced.latestUsage?.contextSize}
                        messageCount={rootMessageCount}
                        totalMessages={props.totalMessages}
                        controlledByUser={controlledByUser}
                        onCollaborationModeChange={
                            codexCollaborationModeSupported && props.session.active && !controlledByUser
                                ? handleCollaborationModeChange
                                : undefined
                        }
                        onPermissionModeChange={handlePermissionModeChange}
                        onModelChange={handleModelChange}
                        onModelReasoningEffortChange={
                            agentFlavor === 'codex' && props.session.active && !controlledByUser
                                ? handleModelReasoningEffortChange
                                : undefined
                        }
                        onEffortChange={handleEffortChange}
                        onSwitchToRemote={handleSwitchToRemote}
                        onTerminal={props.session.active && terminalSupported ? handleViewTerminal : undefined}
                        terminalUnsupported={props.session.active && !terminalSupported}
                        autocompleteSuggestions={props.autocompleteSuggestions}
                        voiceStatus={voice?.status}
                        voiceMicMuted={voice?.micMuted}
                        onVoiceToggle={voice ? handleVoiceToggle : undefined}
                        onVoiceMicToggle={voice ? handleVoiceMicToggle : undefined}
                        sendQueued={props.onSendQueued}
                        sessionId={props.sessionId ?? props.session.id}
                    />
                    </div>
                    )}
                </div>
            </ComposerProvider>
            </ChatProvider>

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
})
