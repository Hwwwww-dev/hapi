import type { CanonicalRootBlock } from '@hapi/protocol'

import type { Store, StoredSessionParseState } from '../store'
import { parseSessionRawEvents, type SessionParserState } from './parser'

export type CanonicalResetReason = 'rebuild' | 'late-earlier-event' | 'parser-version-change'

export type RebuildSessionCanonicalStateResult = {
    roots: CanonicalRootBlock[]
    activeGeneration: number
    parserVersion: number
    latestStreamSeq: number
    resetReason: CanonicalResetReason
    queuedEarlierThanSnapshot: boolean
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

export async function rebuildSessionCanonicalState(options: {
    store: Store
    sessionId: string
    parserVersion: number
    reason?: CanonicalResetReason
    now?: () => number
}): Promise<RebuildSessionCanonicalStateResult> {
    const now = options.now ?? (() => Date.now())
    const previousState = options.store.sessionParseState.getBySessionId(options.sessionId)
    const snapshotRowsByIngest = options.store.rawEvents.listBySession(options.sessionId)
    const snapshotMaxIngestSeq = snapshotRowsByIngest.at(-1)?.ingestSeq ?? 0
    const snapshotRows = [...snapshotRowsByIngest].sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    const nextGeneration = Math.max(1, (previousState?.activeGeneration ?? 0) + 1)
    const startedAt = now()

    const parsed = parseSessionRawEvents({
        sessionId: options.sessionId,
        parserVersion: options.parserVersion,
        rawEvents: snapshotRows,
        previousState: {
            generation: nextGeneration,
            latestStreamSeq: 0,
            lastProcessedRawSortKey: null,
            lastProcessedRawEventId: null,
            rootIndex: restoreRootIndex(previousState),
            roots: []
        }
    })

    const completedAt = now()
    const latestStreamSeq = (previousState?.latestStreamSeq ?? 0) + 1
    const snapshotBoundary = snapshotRows.at(-1)

    options.store.canonicalBlocks.replaceGeneration(options.sessionId, nextGeneration, parsed.roots)
    options.store.sessionParseState.upsert({
        sessionId: options.sessionId,
        parserVersion: options.parserVersion,
        activeGeneration: nextGeneration,
        state: {
            rootIndex: parsed.nextState.rootIndex
        },
        lastProcessedRawSortKey: snapshotBoundary?.sortKey ?? null,
        lastProcessedRawEventId: snapshotBoundary?.id ?? null,
        latestStreamSeq,
        rebuildRequired: false,
        lastRebuildStartedAt: startedAt,
        lastRebuildCompletedAt: completedAt
    })

    const queuedEarlierThanSnapshot = snapshotBoundary
        ? options.store.rawEvents.listBySession(options.sessionId)
            .filter((row) => row.ingestSeq > snapshotMaxIngestSeq)
            .some((row) => row.sortKey.localeCompare(snapshotBoundary.sortKey) < 0)
        : false

    if (queuedEarlierThanSnapshot) {
        options.store.sessionParseState.upsert({
            sessionId: options.sessionId,
            parserVersion: options.parserVersion,
            activeGeneration: nextGeneration,
            state: {
                rootIndex: parsed.nextState.rootIndex
            },
            lastProcessedRawSortKey: snapshotBoundary?.sortKey ?? null,
            lastProcessedRawEventId: snapshotBoundary?.id ?? null,
            latestStreamSeq,
            rebuildRequired: true,
            lastRebuildStartedAt: startedAt,
            lastRebuildCompletedAt: completedAt
        })
    }

    return {
        roots: parsed.roots,
        activeGeneration: nextGeneration,
        parserVersion: options.parserVersion,
        latestStreamSeq,
        resetReason: options.reason ?? 'rebuild',
        queuedEarlierThanSnapshot
    }
}
