import type { Database } from 'bun:sqlite'

import { safeJsonParse } from './json'
import type { StoredSessionParseState } from './types'

type DbSessionParseStateRow = {
    session_id: string
    parser_version: number
    active_generation: number
    state_json: string
    last_processed_raw_sort_key: string | null
    last_processed_raw_event_id: string | null
    latest_stream_seq: number
    rebuild_required: number
    last_rebuild_started_at: number | null
    last_rebuild_completed_at: number | null
}

function serializeStateJson(state: unknown): string {
    const json = JSON.stringify(state)
    if (json === undefined) {
        throw new Error('Session parse state must be JSON-serializable before storage')
    }
    return json
}

function parseStateJson(value: string): unknown {
    const parsed = safeJsonParse(value)
    if (parsed === null && value.trim() !== 'null') {
        throw new Error('Invalid JSON in session_parse_state.state_json')
    }
    return parsed
}

function toStoredSessionParseState(row: DbSessionParseStateRow): StoredSessionParseState {
    return {
        sessionId: row.session_id,
        parserVersion: row.parser_version,
        activeGeneration: row.active_generation,
        state: parseStateJson(row.state_json),
        lastProcessedRawSortKey: row.last_processed_raw_sort_key,
        lastProcessedRawEventId: row.last_processed_raw_event_id,
        latestStreamSeq: row.latest_stream_seq,
        rebuildRequired: row.rebuild_required !== 0,
        lastRebuildStartedAt: row.last_rebuild_started_at,
        lastRebuildCompletedAt: row.last_rebuild_completed_at
    }
}

export function getSessionParseStateBySessionId(db: Database, sessionId: string): StoredSessionParseState | null {
    const row = db.prepare(
        'SELECT * FROM session_parse_state WHERE session_id = ? LIMIT 1'
    ).get(sessionId) as DbSessionParseStateRow | undefined

    return row ? toStoredSessionParseState(row) : null
}

export function upsertSessionParseState(db: Database, state: StoredSessionParseState): StoredSessionParseState {
    db.prepare(`
        INSERT INTO session_parse_state (
            session_id,
            parser_version,
            active_generation,
            state_json,
            last_processed_raw_sort_key,
            last_processed_raw_event_id,
            latest_stream_seq,
            rebuild_required,
            last_rebuild_started_at,
            last_rebuild_completed_at
        ) VALUES (
            @session_id,
            @parser_version,
            @active_generation,
            @state_json,
            @last_processed_raw_sort_key,
            @last_processed_raw_event_id,
            @latest_stream_seq,
            @rebuild_required,
            @last_rebuild_started_at,
            @last_rebuild_completed_at
        )
        ON CONFLICT(session_id) DO UPDATE SET
            parser_version = excluded.parser_version,
            active_generation = excluded.active_generation,
            state_json = excluded.state_json,
            last_processed_raw_sort_key = excluded.last_processed_raw_sort_key,
            last_processed_raw_event_id = excluded.last_processed_raw_event_id,
            latest_stream_seq = excluded.latest_stream_seq,
            rebuild_required = excluded.rebuild_required,
            last_rebuild_started_at = excluded.last_rebuild_started_at,
            last_rebuild_completed_at = excluded.last_rebuild_completed_at
    `).run({
        session_id: state.sessionId,
        parser_version: state.parserVersion,
        active_generation: state.activeGeneration,
        state_json: serializeStateJson(state.state),
        last_processed_raw_sort_key: state.lastProcessedRawSortKey,
        last_processed_raw_event_id: state.lastProcessedRawEventId,
        latest_stream_seq: state.latestStreamSeq,
        rebuild_required: state.rebuildRequired ? 1 : 0,
        last_rebuild_started_at: state.lastRebuildStartedAt,
        last_rebuild_completed_at: state.lastRebuildCompletedAt
    })

    return getSessionParseStateBySessionId(db, state.sessionId)
        ?? (() => { throw new Error('Failed to persist session parse state') })()
}
