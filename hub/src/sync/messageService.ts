import type {
    AttachmentMetadata,
    DecryptedMessage
} from '@hapi/protocol/types'
import type {
    CanonicalMessagesPage,
    CanonicalRootBlock,
    RawEventProvider,
    RawEventEnvelope
} from '@hapi/protocol'
import type { Server } from 'socket.io'

import type { Store, StoredRawEvent, StoredSessionParseState } from '../store'
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

type RawEventsStoreIngestOutcome = {
    result: CanonicalIngestResult
    mode: 'noop' | 'incremental' | 'rebuild'
    emittedOps: ParserEmittedOp[]
    insertedEvents: StoredRawEvent[]
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function isRuntimeProvider(value: unknown): value is Extract<RawEventProvider, 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode'> {
    return value === 'claude'
        || value === 'codex'
        || value === 'gemini'
        || value === 'cursor'
        || value === 'opencode'
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return isObject(value) ? value : null
}

function resolveOutboundProvider(sessionMetadata: unknown): Extract<RawEventProvider, 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode'> {
    const metadata = asRecord(sessionMetadata)
    if (isRuntimeProvider(metadata?.flavor)) {
        return metadata.flavor
    }

    return 'claude'
}

function resolveOutboundSourceSessionId(
    sessionId: string,
    provider: Extract<RawEventProvider, 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode'>,
    sessionMetadata: unknown
): string {
    const metadata = asRecord(sessionMetadata)
    if (!metadata) {
        return sessionId
    }

    if (provider === 'claude') {
        return asString(metadata.claudeSessionId) ?? sessionId
    }
    if (provider === 'codex') {
        return asString(metadata.codexSessionId) ?? sessionId
    }
    if (provider === 'gemini') {
        return asString(metadata.geminiSessionId) ?? sessionId
    }
    if (provider === 'cursor') {
        return asString(metadata.cursorSessionId) ?? sessionId
    }
    if (provider === 'opencode') {
        return asString(metadata.opencodeSessionId) ?? sessionId
    }

    return sessionId
}

function resolveOutboundChannel(
    provider: Extract<RawEventProvider, 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode'>
): string {
    return provider === 'claude'
        ? 'claude:runtime:messages'
        : `${provider}:runtime`
}

function buildOutboundUserRawEvent(params: {
    sessionId: string
    sessionMetadata: unknown
    message: DecryptedMessage
    sentFrom: 'telegram-bot' | 'webapp'
}): RawEventEnvelope {
    const provider = resolveOutboundProvider(params.sessionMetadata)
    const sourceSessionId = resolveOutboundSourceSessionId(params.sessionId, provider, params.sessionMetadata)
    const sourceKey = `outbound-user:${params.sentFrom}:${params.message.id}`
    const text = isObject(params.message.content)
        && isObject(params.message.content.content)
        && typeof params.message.content.content.text === 'string'
        ? params.message.content.content.text
        : ''
    const attachments = isObject(params.message.content)
        && isObject(params.message.content.content)
        && Array.isArray(params.message.content.content.attachments)
        ? params.message.content.content.attachments
        : undefined

    return {
        id: `hub:${params.sessionId}:${sourceKey}`,
        sessionId: params.sessionId,
        provider,
        source: 'runtime',
        sourceSessionId,
        sourceKey,
        observationKey: null,
        channel: resolveOutboundChannel(provider),
        sourceOrder: params.message.seq ?? params.message.createdAt,
        occurredAt: params.message.createdAt,
        ingestedAt: Date.now(),
        rawType: 'user',
        payload: {
            type: 'user',
            role: 'user',
            content: {
                type: 'text',
                text,
                attachments
            },
            localId: params.message.localId ?? undefined,
            message: {
                role: 'user',
                content: text
            },
            meta: {
                sentFrom: params.sentFrom
            }
        },
        ingestSchemaVersion: 1
    }
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

function toSessionBackfillLocalId(payload: Record<string, unknown>): string | null {
    const message = isObject(payload.message) ? payload.message : null
    return asString(payload.localId)
        ?? asString(message?.localId)
        ?? null
}

function toUserVisibleOutboundBackfillMessage(rawEvent: StoredRawEvent): DecryptedMessage | null {
    if (!isObject(rawEvent.payload)) {
        return null
    }

    const payload = rawEvent.payload
    const meta = isObject(payload.meta) ? payload.meta : null
    const sentFrom = asString(meta?.sentFrom)
    if (sentFrom === 'cli') {
        return null
    }

    if (payload.role === 'user' && isObject(payload.content)) {
        if (sentFrom !== 'webapp' && sentFrom !== 'telegram-bot') {
            return null
        }

        const text = asString(payload.content.text)?.trim()
        const attachments = Array.isArray(payload.content.attachments)
            ? payload.content.attachments
            : undefined
        if (!text && (!attachments || attachments.length === 0)) {
            return null
        }

        return {
            id: rawEvent.id,
            seq: rawEvent.ingestSeq,
            createdAt: rawEvent.occurredAt,
            localId: toSessionBackfillLocalId(payload),
            content: {
                role: 'user',
                content: {
                    type: 'text',
                    text: text ?? '',
                    attachments
                },
                meta: {
                    sentFrom
                }
            }
        }
    }

    if (rawEvent.rawType !== 'user') {
        return null
    }
    if (sentFrom !== 'webapp' && sentFrom !== 'telegram-bot') {
        return null
    }
    if (payload.isSidechain === true || payload.isMeta === true) {
        return null
    }

    const message = isObject(payload.message) ? payload.message : null
    const text = asString(message?.content)?.trim()
    if (!text) {
        return null
    }

    return {
        id: rawEvent.id,
        seq: rawEvent.ingestSeq,
        createdAt: rawEvent.occurredAt,
        localId: toSessionBackfillLocalId(payload),
        content: {
            role: 'user',
            content: {
                type: 'text',
                text
            },
            meta: {
                sentFrom
            }
        }
    }
}

export async function ingestRawEventsIntoCanonicalStore(
    store: Store,
    sessionId: string,
    events: RawEventEnvelope[]
): Promise<RawEventsStoreIngestOutcome> {
    const inserted = events
        .map((event) => store.rawEvents.ingest(event))
        .filter((result) => result.inserted)
        .map((result) => result.event)

    const existingState = store.sessionParseState.getBySessionId(sessionId)
    if (inserted.length === 0 && existingState) {
        return {
            result: {
                imported: 0,
                activeGeneration: existingState.activeGeneration,
                parserVersion: existingState.parserVersion,
                latestStreamSeq: existingState.latestStreamSeq,
                resetReason: null
            },
            mode: 'noop',
            emittedOps: [],
            insertedEvents: []
        }
    }

    const hasLateEarlierEvent = Boolean(
        existingState?.lastProcessedRawSortKey
        && inserted.some((event) => event.sortKey.localeCompare(existingState.lastProcessedRawSortKey as string) < 0)
    )
    const parserVersionChanged = Boolean(existingState && existingState.parserVersion !== CANONICAL_PARSER_VERSION)
    const shouldRebuild = Boolean(existingState?.rebuildRequired || hasLateEarlierEvent || parserVersionChanged)

    if (shouldRebuild) {
        const rebuilt = await rebuildSessionCanonicalState({
            store,
            sessionId,
            parserVersion: CANONICAL_PARSER_VERSION,
            reason: hasLateEarlierEvent ? 'late-earlier-event' : (parserVersionChanged ? 'parser-version-change' : 'rebuild')
        })

        return {
            result: {
                imported: inserted.length,
                activeGeneration: rebuilt.activeGeneration,
                parserVersion: rebuilt.parserVersion,
                latestStreamSeq: rebuilt.latestStreamSeq,
                resetReason: rebuilt.resetReason
            },
            mode: 'rebuild',
            emittedOps: [],
            insertedEvents: inserted
        }
    }

    const rawEvents = store.rawEvents.listForParserReplay(sessionId)
    const parsed = parseSessionRawEvents({
        sessionId,
        parserVersion: CANONICAL_PARSER_VERSION,
        rawEvents,
        previousState: toParserPreviousState(existingState)
    })
    const activeGeneration = existingState?.activeGeneration ?? parsed.nextState.generation

    store.canonicalBlocks.replaceGeneration(sessionId, activeGeneration, parsed.roots)
    store.sessionParseState.upsert({
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

    return {
        result: {
            imported: inserted.length,
            activeGeneration,
            parserVersion: CANONICAL_PARSER_VERSION,
            latestStreamSeq: parsed.nextState.latestStreamSeq,
            resetReason: null
        },
        mode: 'incremental',
        emittedOps: parsed.emittedOps,
        insertedEvents: inserted
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

    getCliBackfillMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        const safeLimit = Number.isFinite(options.limit)
            ? Math.max(1, Math.min(200, Math.trunc(options.limit)))
            : 200

        const messages: DecryptedMessage[] = []
        let rawCursor = Number.isFinite(options.afterSeq)
            ? Math.max(0, Math.trunc(options.afterSeq))
            : 0

        while (messages.length < safeLimit) {
            const batch = this.store.rawEvents.listRuntimeAfterIngestSeq(
                sessionId,
                rawCursor,
                Math.max(safeLimit, 50)
            )

            if (batch.length === 0) {
                break
            }

            for (const rawEvent of batch) {
                rawCursor = rawEvent.ingestSeq
                const message = toUserVisibleOutboundBackfillMessage(rawEvent)
                if (!message) {
                    continue
                }
                messages.push(message)
                if (messages.length >= safeLimit) {
                    break
                }
            }

            if (batch.length < Math.max(safeLimit, 50)) {
                break
            }
        }

        return messages
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
        const outcome = await ingestRawEventsIntoCanonicalStore(this.store, sessionId, events)
        if (outcome.insertedEvents.length > 0) {
            this.touchSessionTimeline(sessionId, outcome.insertedEvents)
        }

        if (outcome.mode === 'rebuild') {
            this.publisher.emit({
                type: 'canonical-reset',
                sessionId,
                generation: outcome.result.activeGeneration,
                parserVersion: outcome.result.parserVersion,
                streamSeq: outcome.result.latestStreamSeq,
                reason: outcome.result.resetReason ?? 'rebuild'
            })
            this.broadcastSessionUpdated(sessionId)
            return outcome.result
        }

        if (outcome.mode === 'incremental') {
            this.publishCanonicalOps(
                sessionId,
                outcome.result.activeGeneration,
                outcome.result.parserVersion,
                outcome.emittedOps,
                outcome.result.latestStreamSeq
            )
            if (outcome.result.imported > 0) {
                this.broadcastSessionUpdated(sessionId)
            }
        }

        return outcome.result
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

        const transientMessage: DecryptedMessage = {
            id: payload.localId ?? `outbound-user:${sessionId}:${Date.now()}`,
            seq: null,
            localId: payload.localId ?? null,
            content,
            createdAt: Date.now()
        }
        maybeApplyFirstMessageSessionTitle(this.store, sessionId, transientMessage.content, transientMessage.createdAt)

        const session = this.store.sessions.getSession(sessionId)
        await this.ingestRawEvents(sessionId, [buildOutboundUserRawEvent({
            sessionId,
            sessionMetadata: session?.metadata ?? null,
            message: transientMessage,
            sentFrom
        })])

        const storedRawEvent = this.store.rawEvents
            .listBySession(sessionId)
            .find((event) => event.id === `hub:${sessionId}:outbound-user:${sentFrom}:${transientMessage.id}`)

        this.broadcastNewMessage(sessionId, {
            id: transientMessage.id,
            seq: storedRawEvent?.ingestSeq ?? null,
            localId: transientMessage.localId,
            content: transientMessage.content,
            createdAt: transientMessage.createdAt
        })
    }

    private publishCanonicalOps(
        sessionId: string,
        generation: number,
        parserVersion: number,
        emittedOps: ParserEmittedOp[],
        latestStreamSeq: number
    ): void {
        if (emittedOps.length === 0) {
            return
        }

        const streamSeqBase = latestStreamSeq - emittedOps.length
        for (const [index, op] of emittedOps.entries()) {
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

    private touchSessionTimeline(sessionId: string, rawEvents: readonly StoredRawEvent[]): void {
        if (rawEvents.length === 0) {
            return
        }

        const session = this.store.sessions.getSession(sessionId)
        if (!session) {
            return
        }

        const earliestOccurredAt = rawEvents.reduce(
            (minTimestamp, event) => Math.min(minTimestamp, event.occurredAt),
            rawEvents[0]?.occurredAt ?? session.createdAt
        )
        const latestOccurredAt = rawEvents.reduce(
            (maxTimestamp, event) => Math.max(maxTimestamp, event.occurredAt),
            rawEvents[0]?.occurredAt ?? session.updatedAt
        )

        this.store.sessions.reconcileSessionTimestamps(sessionId, session.namespace, {
            createdAt: Math.min(session.createdAt, earliestOccurredAt),
            lastActivityAt: Math.max(session.updatedAt, latestOccurredAt)
        })
    }
}
