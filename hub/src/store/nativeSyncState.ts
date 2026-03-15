import type { Database } from 'bun:sqlite'

import type { StoredNativeSyncState } from './types'

type DbNativeSyncStateRow = {
    session_id: string
    provider: 'claude' | 'codex'
    native_session_id: string
    machine_id: string
    cursor: string | null
    file_path: string | null
    mtime: number | null
    last_synced_at: number | null
    sync_status: 'healthy' | 'error'
    last_error: string | null
}

function toStoredNativeSyncState(row: DbNativeSyncStateRow): StoredNativeSyncState {
    return {
        sessionId: row.session_id,
        provider: row.provider,
        nativeSessionId: row.native_session_id,
        machineId: row.machine_id,
        cursor: row.cursor,
        filePath: row.file_path,
        mtime: row.mtime,
        lastSyncedAt: row.last_synced_at,
        syncStatus: row.sync_status,
        lastError: row.last_error
    }
}

export function getNativeSyncStateBySessionId(db: Database, sessionId: string): StoredNativeSyncState | null {
    const row = db.prepare(
        'SELECT * FROM native_sync_state WHERE session_id = ? LIMIT 1'
    ).get(sessionId) as DbNativeSyncStateRow | undefined
    return row ? toStoredNativeSyncState(row) : null
}

export function listNativeSyncStateByMachine(db: Database, machineId: string): StoredNativeSyncState[] {
    const rows = db.prepare(
        'SELECT * FROM native_sync_state WHERE machine_id = ? ORDER BY last_synced_at DESC, session_id ASC'
    ).all(machineId) as DbNativeSyncStateRow[]
    return rows.map(toStoredNativeSyncState)
}

export function upsertNativeSyncState(db: Database, state: StoredNativeSyncState): StoredNativeSyncState {
    db.prepare(`
        INSERT INTO native_sync_state (
            session_id,
            provider,
            native_session_id,
            machine_id,
            cursor,
            file_path,
            mtime,
            last_synced_at,
            sync_status,
            last_error
        ) VALUES (
            @session_id,
            @provider,
            @native_session_id,
            @machine_id,
            @cursor,
            @file_path,
            @mtime,
            @last_synced_at,
            @sync_status,
            @last_error
        )
        ON CONFLICT(session_id) DO UPDATE SET
            provider = excluded.provider,
            native_session_id = excluded.native_session_id,
            machine_id = excluded.machine_id,
            cursor = excluded.cursor,
            file_path = excluded.file_path,
            mtime = excluded.mtime,
            last_synced_at = excluded.last_synced_at,
            sync_status = excluded.sync_status,
            last_error = excluded.last_error
    `).run({
        session_id: state.sessionId,
        provider: state.provider,
        native_session_id: state.nativeSessionId,
        machine_id: state.machineId,
        cursor: state.cursor,
        file_path: state.filePath,
        mtime: state.mtime,
        last_synced_at: state.lastSyncedAt,
        sync_status: state.syncStatus,
        last_error: state.lastError
    })

    return getNativeSyncStateBySessionId(db, state.sessionId)
        ?? (() => { throw new Error('Failed to persist native sync state') })()
}

export function markNativeSyncStateError(
    db: Database,
    sessionId: string,
    message: string,
    timestamp: number
): StoredNativeSyncState | null {
    db.prepare(`
        UPDATE native_sync_state
        SET sync_status = 'error',
            last_error = @last_error,
            last_synced_at = @last_synced_at
        WHERE session_id = @session_id
    `).run({
        session_id: sessionId,
        last_error: message,
        last_synced_at: timestamp
    })

    return getNativeSyncStateBySessionId(db, sessionId)
}
