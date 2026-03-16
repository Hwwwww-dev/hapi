import { isObject } from './utils'

export const SESSION_TITLE_MAX_CHARS = 50

export type SessionTitleSummarySource = 'generated' | 'first-message'

type SessionTitleMetadataLike = {
    name?: unknown
    path?: unknown
    summary?: {
        text?: unknown
        source?: unknown
    } | null
    nativeProvider?: unknown
    nativeSessionId?: unknown
} | null | undefined

type SessionTitleSessionLike = {
    id: unknown
    metadata?: SessionTitleMetadataLike
}

function getSessionIdPrefix(value: unknown): string {
    return typeof value === 'string' && value.length > 0 ? value.slice(0, 8) : 'unknown'
}

function normalizeTitleText(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

function getTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }

    const trimmed = normalizeTitleText(value)
    return trimmed.length > 0 ? trimmed : null
}

function extractTextFromStructuredContent(value: unknown): string | null {
    if (typeof value === 'string') {
        return getTrimmedString(value)
    }

    if (!Array.isArray(value)) {
        return null
    }

    for (const item of value) {
        if (!isObject(item)) {
            continue
        }

        const text = getTrimmedString(item.text)
        if (text) {
            return text
        }
    }

    return null
}

export function truncateSessionTitle(value: string, maxChars: number = SESSION_TITLE_MAX_CHARS): string {
    const normalized = normalizeTitleText(value)
    if (!normalized) {
        return ''
    }

    return Array.from(normalized).slice(0, maxChars).join('')
}

export function createSessionTitleSummary(
    value: string,
    updatedAt: number,
    source: SessionTitleSummarySource
): { text: string; updatedAt: number; source: SessionTitleSummarySource } {
    return {
        text: truncateSessionTitle(value),
        updatedAt,
        source
    }
}

export function getExplicitSessionTitle(metadata: SessionTitleMetadataLike): string | null {
    const name = getTrimmedString(metadata?.name)
    if (name) {
        return name
    }

    const summary = getTrimmedString(metadata?.summary?.text)
    if (summary) {
        return summary
    }

    return null
}

export function getSessionPathFallbackTitle(sessionId: string, metadata: SessionTitleMetadataLike): string {
    const path = getTrimmedString(metadata?.path)
    if (path) {
        const parts = path.split(/[\\/]+/).filter(Boolean)
        if (parts.length > 0) {
            return parts[parts.length - 1] ?? getSessionIdPrefix(sessionId)
        }
    }

    return getSessionIdPrefix(sessionId)
}

export function getSessionListFallbackTitle(sessionId: string, metadata: SessionTitleMetadataLike): string {
    const nativeSessionId = getTrimmedString(metadata?.nativeSessionId)
    if (nativeSessionId) {
        const provider = getTrimmedString(metadata?.nativeProvider)
        return provider ? `${provider} ${nativeSessionId.slice(0, 8)}` : nativeSessionId.slice(0, 8)
    }

    return getSessionPathFallbackTitle(sessionId, metadata)
}

export function getSessionDisplayTitle(
    session: SessionTitleSessionLike,
    options?: { preferNativeShortIdFallback?: boolean }
): string {
    const explicit = getExplicitSessionTitle(session.metadata)
    if (explicit) {
        return explicit
    }

    if (options?.preferNativeShortIdFallback) {
        return getSessionListFallbackTitle(typeof session.id === 'string' ? session.id : 'unknown', session.metadata)
    }

    return getSessionPathFallbackTitle(typeof session.id === 'string' ? session.id : 'unknown', session.metadata)
}

export function extractSessionTitleFromMessageContent(content: unknown): string | null {
    if (!isObject(content)) {
        return null
    }

    if (content.role === 'user' && isObject(content.content) && content.content.type === 'text') {
        const text = getTrimmedString(content.content.text)
        return text ? truncateSessionTitle(text) : null
    }

    if (content.type === 'user' && isObject(content.message)) {
        const text = extractTextFromStructuredContent(content.message.content)
        return text ? truncateSessionTitle(text) : null
    }

    if (content.type === 'event_msg' && isObject(content.payload) && content.payload.type === 'user_message') {
        const text = getTrimmedString(content.payload.message)
        return text ? truncateSessionTitle(text) : null
    }

    return null
}
