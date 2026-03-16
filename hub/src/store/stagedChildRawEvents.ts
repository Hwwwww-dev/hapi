import type { Database } from 'bun:sqlite'
import type { RawEventEnvelope } from '@hapi/protocol'

import { safeJsonParse } from './json'
import { ingestRawEvent } from './rawEvents'
import type { StoredStagedChildRawEvent, StoredStagedChildRawEventPayload } from './types'

export type RehomeStagedChildRawEventsParams = {
    childIdentity: string
    sessionId: string
}

type DbStagedChildRawEventRow = {
    id: string
    provider: StoredStagedChildRawEvent['provider']
    child_identity: string
    payload_json: string
    staged_at: number
}

function serializePayloadJson(payload: StoredStagedChildRawEventPayload): string {
    const json = JSON.stringify(payload)
    if (json === undefined) {
        throw new Error('Staged child raw event payload must be JSON-serializable before storage')
    }
    return json
}

function parsePayloadJson(value: string): StoredStagedChildRawEventPayload {
    const parsed = safeJsonParse(value)
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('staged_child_raw_events.payload_json must decode to an object')
    }

    return parsed as StoredStagedChildRawEventPayload
}

function toStoredStagedChildRawEvent(row: DbStagedChildRawEventRow): StoredStagedChildRawEvent {
    return {
        id: row.id,
        provider: row.provider,
        childIdentity: row.child_identity,
        payload: parsePayloadJson(row.payload_json),
        stagedAt: row.staged_at
    }
}

function validateStagedChildRawEvent(event: StoredStagedChildRawEvent): void {
    if (event.id !== event.payload.id) {
        throw new Error(`Staged child raw event ${event.id} must match payload id ${event.payload.id}`)
    }

    if (event.provider !== event.payload.provider) {
        throw new Error(`Staged child raw event ${event.id} must match payload provider ${event.payload.provider}`)
    }
}

function getStagedChildRawEventById(db: Database, id: string): StoredStagedChildRawEvent | null {
    const row = db.prepare(
        'SELECT * FROM staged_child_raw_events WHERE id = ? LIMIT 1'
    ).get(id) as DbStagedChildRawEventRow | undefined

    return row ? toStoredStagedChildRawEvent(row) : null
}

function listStagedChildRawEventsByChildIdentity(db: Database, childIdentity: string): StoredStagedChildRawEvent[] {
    const rows = db.prepare(`
        SELECT * FROM staged_child_raw_events
        WHERE child_identity = ?
        ORDER BY staged_at ASC, id ASC
    `).all(childIdentity) as DbStagedChildRawEventRow[]

    return rows.map(toStoredStagedChildRawEvent)
}

export function stageStagedChildRawEvent(db: Database, event: StoredStagedChildRawEvent): StoredStagedChildRawEvent {
    validateStagedChildRawEvent(event)

    db.prepare(`
        INSERT OR REPLACE INTO staged_child_raw_events (
            id,
            provider,
            child_identity,
            payload_json,
            staged_at
        ) VALUES (
            @id,
            @provider,
            @child_identity,
            @payload_json,
            @staged_at
        )
    `).run({
        id: event.id,
        provider: event.provider,
        child_identity: event.childIdentity,
        payload_json: serializePayloadJson(event.payload),
        staged_at: event.stagedAt
    })

    return getStagedChildRawEventById(db, event.id)
        ?? (() => { throw new Error('Failed to persist staged child raw event') })()
}

export function listAllStagedChildRawEvents(db: Database): StoredStagedChildRawEvent[] {
    const rows = db.prepare(`
        SELECT * FROM staged_child_raw_events
        ORDER BY staged_at ASC, id ASC
    `).all() as DbStagedChildRawEventRow[]

    return rows.map(toStoredStagedChildRawEvent)
}

export function deleteStagedChildRawEventsByChildIdentity(db: Database, childIdentity: string): number {
    const result = db.prepare(
        'DELETE FROM staged_child_raw_events WHERE child_identity = ?'
    ).run(childIdentity)

    return result.changes
}

function toRehomedRawEvent(sessionId: string, payload: StoredStagedChildRawEventPayload): RawEventEnvelope {
    return {
        ...payload,
        sessionId
    }
}

export function rehomeStagedChildRawEventsToSession(
    db: Database,
    params: RehomeStagedChildRawEventsParams
): number {
    try {
        db.exec('BEGIN')

        const stagedRows = listStagedChildRawEventsByChildIdentity(db, params.childIdentity)
        for (const stagedRow of stagedRows) {
            ingestRawEvent(db, toRehomedRawEvent(params.sessionId, stagedRow.payload))
        }

        deleteStagedChildRawEventsByChildIdentity(db, params.childIdentity)
        db.exec('COMMIT')

        return stagedRows.length
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}
