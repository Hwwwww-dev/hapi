import { getVoiceSession, isVoiceSessionStarted } from '../RealtimeSession'
import {
    formatNewMessages,
    formatPermissionRequest,
    formatReadyEvent,
    formatSessionFocus,
    formatSessionFull,
    formatSessionOffline,
    formatSessionOnline
} from './contextFormatters'
import { VOICE_CONFIG } from '../voiceConfig'
import type { CanonicalRootBlock, Session } from '@/types/api'
import type { CanonicalRenderBlock } from '@/chat/canonical'

interface SessionMetadata {
    summary?: { text?: string }
    path?: string
    machineId?: string
}

// Track which sessions have been reported
const shownSessions = new Set<string>()
let lastFocusSession: string | null = null

// Session and canonical store references
let sessionGetter: ((sessionId: string) => Session | null) | null = null
let rootsGetter: ((sessionId: string) => CanonicalRootBlock[]) | null = null

/**
 * Register the session and canonical-root getters for voice hooks
 */
export function registerVoiceHooksStore(
    getSession: (sessionId: string) => Session | null,
    getRoots: (sessionId: string) => CanonicalRootBlock[]
) {
    sessionGetter = getSession
    rootsGetter = getRoots
}

function reportContextualUpdate(update: string | null | undefined) {
    if (VOICE_CONFIG.ENABLE_DEBUG_LOGGING) {
        console.log('[Voice] Reporting contextual update:', update)
    }
    if (!update) return
    const voice = getVoiceSession()
    if (!voice || !isVoiceSessionStarted()) return
    voice.sendContextualUpdate(update)
}

function reportTextUpdate(update: string | null | undefined) {
    if (VOICE_CONFIG.ENABLE_DEBUG_LOGGING) {
        console.log('[Voice] Reporting text update:', update)
    }
    if (!update) return
    const voice = getVoiceSession()
    if (!voice || !isVoiceSessionStarted()) return
    voice.sendTextMessage(update)
}

function reportSession(sessionId: string) {
    if (shownSessions.has(sessionId)) return
    shownSessions.add(sessionId)

    const session = sessionGetter?.(sessionId) ?? null
    if (!session) return

    const roots = rootsGetter?.(sessionId) ?? []
    const contextUpdate = formatSessionFull(session, roots)
    reportContextualUpdate(contextUpdate)
}

export const voiceHooks = {
    /**
     * Called when a session comes online/connects
     */
    onSessionOnline(sessionId: string, metadata?: SessionMetadata) {
        if (VOICE_CONFIG.DISABLE_SESSION_STATUS) return

        reportSession(sessionId)
        const contextUpdate = formatSessionOnline(sessionId, metadata)
        reportContextualUpdate(contextUpdate)
    },

    /**
     * Called when a session goes offline/disconnects
     */
    onSessionOffline(sessionId: string, metadata?: SessionMetadata) {
        if (VOICE_CONFIG.DISABLE_SESSION_STATUS) return

        reportSession(sessionId)
        const contextUpdate = formatSessionOffline(sessionId, metadata)
        reportContextualUpdate(contextUpdate)
    },

    /**
     * Called when user navigates to/views a session
     */
    onSessionFocus(sessionId: string, metadata?: SessionMetadata) {
        if (VOICE_CONFIG.DISABLE_SESSION_FOCUS) return
        if (lastFocusSession === sessionId) return
        lastFocusSession = sessionId
        reportSession(sessionId)
        reportContextualUpdate(formatSessionFocus(sessionId, metadata))
    },

    /**
     * Called when Claude requests permission for a tool use
     */
    onPermissionRequested(sessionId: string, requestId: string, toolName: string, toolArgs: unknown) {
        if (VOICE_CONFIG.DISABLE_PERMISSION_REQUESTS) return

        reportSession(sessionId)
        reportTextUpdate(formatPermissionRequest(sessionId, requestId, toolName, toolArgs))
    },

    /**
     * Called when agent sends new canonical render blocks
     */
    onBlocks(sessionId: string, blocks: CanonicalRenderBlock[]) {
        if (VOICE_CONFIG.DISABLE_MESSAGES) return

        reportSession(sessionId)
        reportContextualUpdate(formatNewMessages(sessionId, blocks))
    },

    /**
     * Called when voice session starts - returns initial context
     */
    onVoiceStarted(sessionId: string): string {
        if (VOICE_CONFIG.ENABLE_DEBUG_LOGGING) {
            console.log('[Voice] Voice session started for:', sessionId)
        }
        shownSessions.clear()

        const session = sessionGetter?.(sessionId) ?? null
        const roots = rootsGetter?.(sessionId) ?? []

        let prompt = 'THIS IS AN ACTIVE SESSION: \n\n' + formatSessionFull(session, roots)
        shownSessions.add(sessionId)

        return prompt
    },

    /**
     * Called when Claude Code finishes processing (ready event)
     */
    onReady(sessionId: string) {
        if (VOICE_CONFIG.DISABLE_READY_EVENTS) return

        reportSession(sessionId)
        reportTextUpdate(formatReadyEvent(sessionId))
    },

    /**
     * Called when voice session stops
     */
    onVoiceStopped() {
        if (VOICE_CONFIG.ENABLE_DEBUG_LOGGING) {
            console.log('[Voice] Voice session stopped')
        }
        shownSessions.clear()
        lastFocusSession = null
    }
}
