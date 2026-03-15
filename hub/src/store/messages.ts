import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredMessage } from './types'
import { safeJsonParse } from './json'

type DbMessageRow = {
    id: string
    session_id: string
    content: string
    created_at: number
    seq: number
    local_id: string | null
    source_provider: 'claude' | 'codex' | null
    source_session_id: string | null
    source_key: string | null
}

function toStoredMessage(row: DbMessageRow): StoredMessage {
    return {
        id: row.id,
        sessionId: row.session_id,
        content: safeJsonParse(row.content),
        createdAt: row.created_at,
        seq: row.seq,
        localId: row.local_id,
        sourceProvider: row.source_provider,
        sourceSessionId: row.source_session_id,
        sourceKey: row.source_key
    }
}

export type NativeMessageImportPayload = {
    content: unknown
    createdAt: number
    sourceProvider: 'claude' | 'codex'
    sourceSessionId: string
    sourceKey: string
}

function touchSessionUpdatedAt(db: Database, sessionId: string, updatedAt: number): void {
    db.prepare(`
        UPDATE sessions
        SET updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END
        WHERE id = @session_id
    `).run({
        session_id: sessionId,
        updated_at: updatedAt
    })
}

export function addMessage(
    db: Database,
    sessionId: string,
    content: unknown,
    localId?: string
): StoredMessage {
    const now = Date.now()

    if (localId) {
        const existing = db.prepare(
            'SELECT * FROM messages WHERE session_id = ? AND local_id = ? LIMIT 1'
        ).get(sessionId, localId) as DbMessageRow | undefined
        if (existing) {
            return toStoredMessage(existing)
        }
    }

    const msgSeqRow = db.prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM messages WHERE session_id = ?'
    ).get(sessionId) as { nextSeq: number }
    const msgSeq = msgSeqRow.nextSeq

    const id = randomUUID()
    const json = JSON.stringify(content)

    db.prepare(`
        INSERT INTO messages (
            id, session_id, content, created_at, seq, local_id
        ) VALUES (
            @id, @session_id, @content, @created_at, @seq, @local_id
        )
    `).run({
        id,
        session_id: sessionId,
        content: json,
        created_at: now,
        seq: msgSeq,
        local_id: localId ?? null
    })
    touchSessionUpdatedAt(db, sessionId, now)

    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as DbMessageRow | undefined
    if (!row) {
        throw new Error('Failed to create message')
    }
    return toStoredMessage(row)
}

export function getMessages(
    db: Database,
    sessionId: string,
    limit: number = 200,
    beforeSeq?: number
): StoredMessage[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200

    const rows = (beforeSeq !== undefined && beforeSeq !== null && Number.isFinite(beforeSeq))
        ? db.prepare(
            'SELECT * FROM messages WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?'
        ).all(sessionId, beforeSeq, safeLimit) as DbMessageRow[]
        : db.prepare(
            'SELECT * FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?'
        ).all(sessionId, safeLimit) as DbMessageRow[]

    return rows.reverse().map(toStoredMessage)
}

export function importNativeMessage(
    db: Database,
    sessionId: string,
    payload: NativeMessageImportPayload
): { message: StoredMessage; inserted: boolean; updated: boolean } {
    const nextContentJson = JSON.stringify(payload.content)
    const existing = db.prepare(`
        SELECT * FROM messages
        WHERE session_id = ?
          AND source_provider = ?
          AND source_session_id = ?
          AND source_key = ?
        LIMIT 1
    `).get(
        sessionId,
        payload.sourceProvider,
        payload.sourceSessionId,
        payload.sourceKey
    ) as DbMessageRow | undefined

    if (existing) {
        const needsUpdate = existing.created_at !== payload.createdAt || existing.content !== nextContentJson
        if (!needsUpdate) {
            return {
                message: toStoredMessage(existing),
                inserted: false,
                updated: false
            }
        }

        db.prepare(`
            UPDATE messages
            SET content = ?, created_at = ?
            WHERE id = ?
        `).run(nextContentJson, payload.createdAt, existing.id)
        touchSessionUpdatedAt(db, sessionId, payload.createdAt)

        const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(existing.id) as DbMessageRow | undefined
        if (!updated) {
            throw new Error('Failed to update imported native message')
        }

        return {
            message: toStoredMessage(updated),
            inserted: false,
            updated: true
        }
    }

    const msgSeqRow = db.prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM messages WHERE session_id = ?'
    ).get(sessionId) as { nextSeq: number }
    const id = randomUUID()

    db.prepare(`
        INSERT INTO messages (
            id, session_id, content, created_at, seq, local_id,
            source_provider, source_session_id, source_key
        ) VALUES (
            @id, @session_id, @content, @created_at, @seq, NULL,
            @source_provider, @source_session_id, @source_key
        )
    `).run({
        id,
        session_id: sessionId,
        content: nextContentJson,
        created_at: payload.createdAt,
        seq: msgSeqRow.nextSeq,
        source_provider: payload.sourceProvider,
        source_session_id: payload.sourceSessionId,
        source_key: payload.sourceKey
    })
    touchSessionUpdatedAt(db, sessionId, payload.createdAt)

    const inserted = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as DbMessageRow | undefined
    if (!inserted) {
        throw new Error('Failed to import native message')
    }

    return {
        message: toStoredMessage(inserted),
        inserted: true,
        updated: false
    }
}

export function getMessagesAfter(
    db: Database,
    sessionId: string,
    afterSeq: number,
    limit: number = 200
): StoredMessage[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200
    const safeAfterSeq = Number.isFinite(afterSeq) ? afterSeq : 0

    const rows = db.prepare(
        'SELECT * FROM messages WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?'
    ).all(sessionId, safeAfterSeq, safeLimit) as DbMessageRow[]

    return rows.map(toStoredMessage)
}

export function getMaxSeq(db: Database, sessionId: string): number {
    const row = db.prepare(
        'SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM messages WHERE session_id = ?'
    ).get(sessionId) as { maxSeq: number } | undefined
    return row?.maxSeq ?? 0
}

export function mergeSessionMessages(
    db: Database,
    fromSessionId: string,
    toSessionId: string,
    options?: {
        strategy?: 'prepend-target' | 'append-source'
    }
): { moved: number; oldMaxSeq: number; newMaxSeq: number } {
    if (fromSessionId === toSessionId) {
        return { moved: 0, oldMaxSeq: 0, newMaxSeq: 0 }
    }

    const oldMaxSeq = getMaxSeq(db, fromSessionId)
    const newMaxSeq = getMaxSeq(db, toSessionId)
    const strategy = options?.strategy ?? 'prepend-target'

    try {
        db.exec('BEGIN')

        if (strategy === 'prepend-target' && newMaxSeq > 0 && oldMaxSeq > 0) {
            db.prepare(
                'UPDATE messages SET seq = seq + ? WHERE session_id = ?'
            ).run(oldMaxSeq, toSessionId)
        }

        if (strategy === 'append-source' && newMaxSeq > 0 && oldMaxSeq > 0) {
            db.prepare(
                'UPDATE messages SET seq = seq + ? WHERE session_id = ?'
            ).run(newMaxSeq, fromSessionId)
        }

        const collisions = db.prepare(`
            SELECT local_id FROM messages
            WHERE session_id = ? AND local_id IS NOT NULL
            INTERSECT
            SELECT local_id FROM messages
            WHERE session_id = ? AND local_id IS NOT NULL
        `).all(toSessionId, fromSessionId) as Array<{ local_id: string }>

        if (collisions.length > 0) {
            const localIds = collisions.map((row) => row.local_id)
            const placeholders = localIds.map(() => '?').join(', ')
            db.prepare(
                `UPDATE messages SET local_id = NULL WHERE session_id = ? AND local_id IN (${placeholders})`
            ).run(fromSessionId, ...localIds)
        }

        const result = db.prepare(
            'UPDATE messages SET session_id = ? WHERE session_id = ?'
        ).run(toSessionId, fromSessionId)

        db.exec('COMMIT')
        return { moved: result.changes, oldMaxSeq, newMaxSeq }
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}
