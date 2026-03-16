import type { Metadata } from '@hapi/protocol/types'
import { createSessionTitleSummary, extractSessionTitleFromMessageContent } from '@hapi/protocol'
import { isObject } from '@hapi/protocol'

import type { Store, StoredSession } from '../store'

function asSessionMetadata(value: unknown): Metadata | null {
    return isObject(value) ? value as Metadata : null
}

function hasSummaryTitle(metadata: Metadata | null): boolean {
    return typeof metadata?.summary?.text === 'string' && metadata.summary.text.trim().length > 0
}

function tryWriteFirstMessageTitle(
    store: Store,
    session: StoredSession,
    title: string,
    createdAt: number
): boolean {
    const metadata = asSessionMetadata(session.metadata)
    if (!metadata || hasSummaryTitle(metadata)) {
        return false
    }

    const result = store.sessions.updateSessionMetadata(
        session.id,
        {
            ...metadata,
            summary: createSessionTitleSummary(title, createdAt, 'first-message')
        },
        session.metadataVersion,
        session.namespace
    )

    return result.result === 'success'
}

export function maybeApplyFirstMessageSessionTitle(
    store: Store,
    sessionId: string,
    content: unknown,
    createdAt: number
): boolean {
    const title = extractSessionTitleFromMessageContent(content)
    if (!title) {
        return false
    }

    const session = store.sessions.getSession(sessionId)
    if (!session) {
        return false
    }

    if (tryWriteFirstMessageTitle(store, session, title, createdAt)) {
        return true
    }

    const refreshed = store.sessions.getSession(sessionId)
    if (!refreshed) {
        return false
    }

    return tryWriteFirstMessageTitle(store, refreshed, title, createdAt)
}
