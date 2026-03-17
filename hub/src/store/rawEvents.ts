import type { Database } from 'bun:sqlite'
import type { RawEventEnvelope, RawEventSource } from '@hapi/protocol'

import { safeJsonParse } from './json'
import type { RawEventIngestResult, StoredRawEvent } from './types'

type DbRawEventRow = {
    ingest_seq: number
    id: string
    session_id: string
    provider: RawEventEnvelope['provider']
    source: RawEventSource
    source_session_id: string
    source_key: string
    observation_key: string | null
    channel: string
    source_order: number
    occurred_at: number
    ingested_at: number
    raw_type: string
    payload: string
    ingest_schema_version: number
}

const RAW_EVENT_SOURCE_RANK: Record<RawEventSource, number> = {
    native: 0,
    runtime: 1
}

const SORT_NUMBER_WIDTH = 20

function getRawEventSourceRank(source: RawEventSource): number {
    const rank = RAW_EVENT_SOURCE_RANK[source]
    if (rank === undefined) {
        throw new Error(`Unsupported raw event source for canonical sort order: ${source}`)
    }
    return rank
}

function encodeSortNumber(value: number): string {
    return Math.trunc(value).toString().padStart(SORT_NUMBER_WIDTH, '0')
}

function encodeSortText(value: string): string {
    return Buffer.from(value, 'utf8').toString('hex')
}

export function buildRawEventSortKey(event: Pick<StoredRawEvent, 'occurredAt' | 'source' | 'channel' | 'sourceOrder' | 'sourceKey' | 'id'>): string {
    return [
        encodeSortNumber(event.occurredAt),
        encodeSortNumber(getRawEventSourceRank(event.source)),
        encodeSortText(event.channel),
        encodeSortNumber(event.sourceOrder),
        encodeSortText(event.sourceKey),
        encodeSortText(event.id)
    ].join('|')
}

function toStoredRawEvent(row: DbRawEventRow): StoredRawEvent {
    return {
        ingestSeq: row.ingest_seq,
        id: row.id,
        sessionId: row.session_id,
        provider: row.provider,
        source: row.source,
        sourceSessionId: row.source_session_id,
        sourceKey: row.source_key,
        observationKey: row.observation_key,
        channel: row.channel,
        sourceOrder: row.source_order,
        occurredAt: row.occurred_at,
        ingestedAt: row.ingested_at,
        rawType: row.raw_type,
        payload: safeJsonParse(row.payload),
        ingestSchemaVersion: row.ingest_schema_version,
        sortKey: buildRawEventSortKey({
            occurredAt: row.occurred_at,
            source: row.source,
            channel: row.channel,
            sourceOrder: row.source_order,
            sourceKey: row.source_key,
            id: row.id
        })
    }
}

function getRawEventById(db: Database, id: string): StoredRawEvent | null {
    const row = db.prepare(
        'SELECT * FROM raw_events WHERE id = ? LIMIT 1'
    ).get(id) as DbRawEventRow | undefined
    return row ? toStoredRawEvent(row) : null
}

function getRawEventByIdentity(
    db: Database,
    identity: Pick<RawEventEnvelope, 'provider' | 'source' | 'sourceSessionId' | 'sourceKey'>
): StoredRawEvent | null {
    const row = db.prepare(`
        SELECT * FROM raw_events
        WHERE provider = ?
          AND source = ?
          AND source_session_id = ?
          AND source_key = ?
        LIMIT 1
    `).get(
        identity.provider,
        identity.source,
        identity.sourceSessionId,
        identity.sourceKey
    ) as DbRawEventRow | undefined

    return row ? toStoredRawEvent(row) : null
}

function serializeRawEventPayload(payload: unknown): string {
    const json = JSON.stringify(payload)
    if (json === undefined) {
        throw new Error('Raw event payload must be JSON-serializable before storage')
    }
    return json
}

export function ingestRawEvent(db: Database, event: RawEventEnvelope): RawEventIngestResult {
    const existing = getRawEventByIdentity(db, event)
    if (existing) {
        return {
            event: existing,
            inserted: false
        }
    }

    const payloadJson = serializeRawEventPayload(event.payload)

    try {
        db.prepare(`
            INSERT INTO raw_events (
                id,
                session_id,
                provider,
                source,
                source_session_id,
                source_key,
                observation_key,
                channel,
                source_order,
                occurred_at,
                ingested_at,
                raw_type,
                payload,
                ingest_schema_version
            ) VALUES (
                @id,
                @session_id,
                @provider,
                @source,
                @source_session_id,
                @source_key,
                @observation_key,
                @channel,
                @source_order,
                @occurred_at,
                @ingested_at,
                @raw_type,
                @payload,
                @ingest_schema_version
            )
        `).run({
            id: event.id,
            session_id: event.sessionId,
            provider: event.provider,
            source: event.source,
            source_session_id: event.sourceSessionId,
            source_key: event.sourceKey,
            observation_key: event.observationKey ?? null,
            channel: event.channel,
            source_order: event.sourceOrder,
            occurred_at: event.occurredAt,
            ingested_at: event.ingestedAt,
            raw_type: event.rawType,
            payload: payloadJson,
            ingest_schema_version: event.ingestSchemaVersion
        })
    } catch (error) {
        const duplicated = getRawEventByIdentity(db, event)
        if (duplicated) {
            return {
                event: duplicated,
                inserted: false
            }
        }
        throw error
    }

    const inserted = getRawEventById(db, event.id)
    if (!inserted) {
        throw new Error('Failed to ingest raw event')
    }

    return {
        event: inserted,
        inserted: true
    }
}

export function listRawEventsBySession(db: Database, sessionId: string): StoredRawEvent[] {
    const rows = db.prepare(
        'SELECT * FROM raw_events WHERE session_id = ? ORDER BY ingest_seq ASC'
    ).all(sessionId) as DbRawEventRow[]

    return rows.map(toStoredRawEvent)
}

export function listRawEventsForParserReplay(db: Database, sessionId: string): StoredRawEvent[] {
    const rows = db.prepare(`
        SELECT * FROM raw_events
        WHERE session_id = ?
        ORDER BY occurred_at ASC,
                 CASE source
                     WHEN 'native' THEN 0
                     WHEN 'runtime' THEN 1
                     ELSE 99
                 END ASC,
                 channel ASC,
                 source_order ASC,
                 source_key ASC,
                 id ASC
    `).all(sessionId) as DbRawEventRow[]

    return rows.map(toStoredRawEvent)
}

export function listRuntimeRawEventsAfterIngestSeq(
    db: Database,
    sessionId: string,
    afterIngestSeq: number,
    limit: number = 200
): StoredRawEvent[] {
    const safeAfterIngestSeq = Number.isFinite(afterIngestSeq)
        ? Math.max(0, Math.trunc(afterIngestSeq))
        : 0
    const safeLimit = Number.isFinite(limit)
        ? Math.max(1, Math.min(1000, Math.trunc(limit)))
        : 200

    const rows = db.prepare(`
        SELECT * FROM raw_events
        WHERE session_id = ?
          AND source = 'runtime'
          AND ingest_seq > ?
        ORDER BY ingest_seq ASC
        LIMIT ?
    `).all(sessionId, safeAfterIngestSeq, safeLimit) as DbRawEventRow[]

    return rows.map(toStoredRawEvent)
}

export function rehomeSessionRawEvents(
    db: Database,
    sourceSessionId: string,
    targetSessionId: string
): number {
    if (!sourceSessionId || !targetSessionId || sourceSessionId === targetSessionId) {
        return 0
    }

    const result = db.prepare(`
        UPDATE raw_events
        SET session_id = ?
        WHERE session_id = ?
    `).run(targetSessionId, sourceSessionId)

    return Number(result.changes ?? 0)
}
