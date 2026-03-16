import type {
    AttachmentMetadata,
    DecryptedMessage
} from '@hapi/protocol/types'
import type {
    CanonicalMessagesPage,
    CanonicalRootBlock,
    RawEventEnvelope
} from '@hapi/protocol'
import type { Server } from 'socket.io'

import type { Store, StoredSessionParseState } from '../store'
import { rebuildSessionCanonicalState, type CanonicalResetReason } from '../canonical/rebuild'
import { parseSessionRawEvents, type ParserEmittedOp, type SessionParserState } from '../canonical/parser'
import { EventPublisher } from './eventPublisher'
import { maybeApplyFirstMessageSessionTitle } from './sessionTitle'

export const CANONICAL_PARSER_VERSION = 1

export class CanonicalGenerationResetRequiredError extends Error {
    readonly generation: number
    readonly parserVersion: number

    constructor(generation: number, parserVersion: number) {
        super(`Canonical generation reset required: active generation ${generation}, parser version ${parserVersion}`)
        this.name = 'CanonicalGenerationResetRequiredError'
        this.generation = generation
        this.parserVersion = parserVersion
    }
}

export type CanonicalIngestResult = {
    imported: number
    activeGeneration: number
    parserVersion: number
    latestStreamSeq: number
    resetReason: CanonicalResetReason | null
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function restoreRootIndex(state: StoredSessionParseState | null): SessionParserState['rootIndex'] {
    if (!state || !isObject(state.state)) {
        return {}
    }

    const rootIndex = state.state.rootIndex
    if (!isObject(rootIndex)) {
        return {}
    }

    const restored: SessionParserState['rootIndex'] = {}
    for (const [rootId, value] of Object.entries(rootIndex)) {
        if (!isObject(value)) {
            continue
        }

        const hash = typeof value.hash === 'string' ? value.hash : null
        const timelineSeq = typeof value.timelineSeq === 'number' && Number.isFinite(value.timelineSeq)
            ? Math.max(0, Math.trunc(value.timelineSeq))
            : null
        if (!hash || timelineSeq === null) {
            continue
        }

        restored[rootId] = { hash, timelineSeq }
    }

    return restored
}

function toParserPreviousState(state: StoredSessionParseState | null): SessionParserState | null {
    if (!state) {
        return null
    }

    return {
        generation: state.activeGeneration,
        latestStreamSeq: state.latestStreamSeq,
        lastProcessedRawSortKey: state.lastProcessedRawSortKey,
        lastProcessedRawEventId: state.lastProcessedRawEventId,
        rootIndex: restoreRootIndex(state),
        roots: []
    }
}

export class MessageService {
    constructor(
        private readonly store: Store,
        private readonly io: Server,
        private readonly publisher: EventPublisher,
        private readonly onSessionTouched: (sessionId: string) => void
    ) {
    }

    getMessagesPage(sessionId: string, options: { limit: number; beforeSeq: number | null }): {
        messages: DecryptedMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
        }
    } {
        const stored = this.store.messages.getMessages(sessionId, options.limit, options.beforeSeq ?? undefined)
        const messages: DecryptedMessage[] = stored.map((message) => ({
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt
        }))

        let oldestSeq: number | null = null
        for (const message of messages) {
            if (typeof message.seq !== 'number') continue
            if (oldestSeq === null || message.seq < oldestSeq) {
                oldestSeq = message.seq
            }
        }

        const nextBeforeSeq = oldestSeq
        const hasMore = nextBeforeSeq !== null
            && this.store.messages.getMessages(sessionId, 1, nextBeforeSeq).length > 0

        return {
            messages,
            page: {
                limit: options.limit,
                beforeSeq: options.beforeSeq,
                nextBeforeSeq,
                hasMore
            }
        }
    }

    getMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        const stored = this.store.messages.getMessagesAfter(sessionId, options.afterSeq, options.limit)
        return stored.map((message) => ({
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt
        }))
    }

    getCanonicalMessagesPage(sessionId: string, options: {
        generation: number | null
        beforeTimelineSeq: number | null
        limit: number
    }): CanonicalMessagesPage {
        const state = this.store.sessionParseState.getBySessionId(sessionId)
        const activeGeneration = state?.activeGeneration ?? 1
        const parserVersion = state?.parserVersion ?? CANONICAL_PARSER_VERSION
        const latestStreamSeq = state?.latestStreamSeq ?? 0

        if (options.generation !== null && options.generation !== activeGeneration) {
            throw new CanonicalGenerationResetRequiredError(activeGeneration, parserVersion)
        }

        const page = this.store.canonicalBlocks.getRootsPage(sessionId, {
            generation: activeGeneration,
            beforeTimelineSeq: options.beforeTimelineSeq,
            limit: options.limit
        })

        return {
            items: page.items,
            page: {
                generation: activeGeneration,
                parserVersion,
                latestStreamSeq,
                limit: page.page.limit,
                beforeTimelineSeq: page.page.beforeTimelineSeq,
                nextBeforeTimelineSeq: page.page.nextBeforeTimelineSeq,
                hasMore: page.page.hasMore
            }
        }
    }

    getCanonicalLatestStreamSeq(sessionId: string): number {
        return this.store.sessionParseState.getBySessionId(sessionId)?.latestStreamSeq ?? 0
    }

    async rebuildSessionCanonicalState(sessionId: string, reason: CanonicalResetReason = 'rebuild'): Promise<{
        roots: CanonicalRootBlock[]
        activeGeneration: number
        parserVersion: number
        latestStreamSeq: number
        resetReason: CanonicalResetReason
    }> {
        const rebuilt = await rebuildSessionCanonicalState({
            store: this.store,
            sessionId,
            parserVersion: CANONICAL_PARSER_VERSION,
            reason
        })

        this.publisher.emit({
            type: 'canonical-reset',
            sessionId,
            generation: rebuilt.activeGeneration,
            parserVersion: rebuilt.parserVersion,
            streamSeq: rebuilt.latestStreamSeq,
            reason: rebuilt.resetReason
        })
        this.broadcastSessionUpdated(sessionId)

        return rebuilt
    }

    async ingestRawEvents(sessionId: string, events: RawEventEnvelope[]): Promise<CanonicalIngestResult> {
        const inserted = events
            .map((event) => this.store.rawEvents.ingest(event))
            .filter((result) => result.inserted)
            .map((result) => result.event)

        const existingState = this.store.sessionParseState.getBySessionId(sessionId)
        if (inserted.length === 0 && existingState) {
            return {
                imported: 0,
                activeGeneration: existingState.activeGeneration,
                parserVersion: existingState.parserVersion,
                latestStreamSeq: existingState.latestStreamSeq,
                resetReason: null
            }
        }

        const hasLateEarlierEvent = Boolean(
            existingState?.lastProcessedRawSortKey
            && inserted.some((event) => event.sortKey.localeCompare(existingState.lastProcessedRawSortKey as string) < 0)
        )
        const parserVersionChanged = Boolean(existingState && existingState.parserVersion !== CANONICAL_PARSER_VERSION)
        const shouldRebuild = Boolean(existingState?.rebuildRequired || hasLateEarlierEvent || parserVersionChanged)

        if (shouldRebuild) {
            const rebuilt = await this.rebuildSessionCanonicalState(
                sessionId,
                hasLateEarlierEvent ? 'late-earlier-event' : (parserVersionChanged ? 'parser-version-change' : 'rebuild')
            )

            return {
                imported: inserted.length,
                activeGeneration: rebuilt.activeGeneration,
                parserVersion: rebuilt.parserVersion,
                latestStreamSeq: rebuilt.latestStreamSeq,
                resetReason: rebuilt.resetReason
            }
        }

        const rawEvents = this.store.rawEvents.listForParserReplay(sessionId)
        const parsed = parseSessionRawEvents({
            sessionId,
            parserVersion: CANONICAL_PARSER_VERSION,
            rawEvents,
            previousState: toParserPreviousState(existingState)
        })
        const activeGeneration = existingState?.activeGeneration ?? parsed.nextState.generation

        this.store.canonicalBlocks.replaceGeneration(sessionId, activeGeneration, parsed.roots)
        this.store.sessionParseState.upsert({
            sessionId,
            parserVersion: CANONICAL_PARSER_VERSION,
            activeGeneration,
            state: {
                rootIndex: parsed.nextState.rootIndex
            },
            lastProcessedRawSortKey: parsed.nextState.lastProcessedRawSortKey,
            lastProcessedRawEventId: parsed.nextState.lastProcessedRawEventId,
            latestStreamSeq: parsed.nextState.latestStreamSeq,
            rebuildRequired: false,
            lastRebuildStartedAt: existingState?.lastRebuildStartedAt ?? null,
            lastRebuildCompletedAt: existingState?.lastRebuildCompletedAt ?? null
        })

        this.publishCanonicalOps(sessionId, activeGeneration, CANONICAL_PARSER_VERSION, parsed)
        if (inserted.length > 0) {
            this.broadcastSessionUpdated(sessionId)
        }

        return {
            imported: inserted.length,
            activeGeneration,
            parserVersion: CANONICAL_PARSER_VERSION,
            latestStreamSeq: parsed.nextState.latestStreamSeq,
            resetReason: null
        }
    }

    importNativeMessages(
        sessionId: string,
        messages: Array<{
            content: unknown
            createdAt: number
            sourceProvider: 'claude' | 'codex'
            sourceSessionId: string
            sourceKey: string
        }>
    ): { imported: number; messages: DecryptedMessage[] } {
        let imported = 0
        const importedMessages: DecryptedMessage[] = []

        for (const item of messages) {
            const result = this.store.messages.importNativeMessage(sessionId, item)
            if (!result.inserted && !result.updated) {
                continue
            }

            if (result.inserted) {
                imported += 1
            }

            let sessionTitleUpdated = false
            if (result.inserted) {
                sessionTitleUpdated = maybeApplyFirstMessageSessionTitle(this.store, sessionId, result.message.content, result.message.createdAt)
            }

            const message: DecryptedMessage = {
                id: result.message.id,
                seq: result.message.seq,
                localId: result.message.localId,
                content: result.message.content,
                createdAt: result.message.createdAt
            }
            if (result.inserted) {
                importedMessages.push(message)
                this.broadcastNewMessage(sessionId, message)
            }

            if (sessionTitleUpdated) {
                this.broadcastSessionUpdated(sessionId)
            }
        }

        return { imported, messages: importedMessages }
    }

    async sendMessage(
        sessionId: string,
        payload: {
            text: string
            localId?: string | null
            attachments?: AttachmentMetadata[]
            sentFrom?: 'telegram-bot' | 'webapp'
        }
    ): Promise<void> {
        const sentFrom = payload.sentFrom ?? 'webapp'

        const content = {
            role: 'user',
            content: {
                type: 'text',
                text: payload.text,
                attachments: payload.attachments
            },
            meta: {
                sentFrom
            }
        }

        const msg = this.store.messages.addMessage(sessionId, content, payload.localId ?? undefined)
        maybeApplyFirstMessageSessionTitle(this.store, sessionId, msg.content, msg.createdAt)
        this.broadcastNewMessage(sessionId, {
            id: msg.id,
            seq: msg.seq,
            localId: msg.localId,
            content: msg.content,
            createdAt: msg.createdAt
        })
        this.broadcastSessionUpdated(sessionId)
    }

    private publishCanonicalOps(
        sessionId: string,
        generation: number,
        parserVersion: number,
        parsed: { emittedOps: ParserEmittedOp[]; nextState: SessionParserState }
    ): void {
        if (parsed.emittedOps.length === 0) {
            return
        }

        const streamSeqBase = parsed.nextState.latestStreamSeq - parsed.emittedOps.length
        for (const [index, op] of parsed.emittedOps.entries()) {
            this.publisher.emit({
                type: 'canonical-root-upsert',
                sessionId,
                generation,
                parserVersion,
                streamSeq: streamSeqBase + index + 1,
                op: op.op,
                root: op.root
            })
        }
    }

    private broadcastNewMessage(sessionId: string, message: DecryptedMessage): void {
        const update = {
            id: message.id,
            seq: message.seq,
            createdAt: message.createdAt,
            body: {
                t: 'new-message' as const,
                sid: sessionId,
                message
            }
        }
        this.io.of('/cli').to(`session:${sessionId}`).emit('update', update)

        this.publisher.emit({
            type: 'message-received',
            sessionId,
            message
        })
    }

    private broadcastSessionUpdated(sessionId: string): void {
        this.onSessionTouched(sessionId)
    }
}
