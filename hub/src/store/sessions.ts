import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredSession, VersionedUpdateResult } from './types'
import { safeJsonParse } from './json'
import { updateVersionedField } from './versionedUpdates'

type DbSessionRow = {
    id: string
    tag: string | null
    namespace: string
    machine_id: string | null
    created_at: number
    updated_at: number
    metadata: string | null
    metadata_version: number
    agent_state: string | null
    agent_state_version: number
    model: string | null
    todos: string | null
    todos_updated_at: number | null
    team_state: string | null
    team_state_updated_at: number | null
    active: number
    active_at: number | null
    seq: number
}

type NativeProvider = 'claude' | 'codex'

type NativeSessionAlias = {
    provider: NativeProvider
    nativeSessionId: string
}

function toStoredSession(row: DbSessionRow): StoredSession {
    return {
        id: row.id,
        tag: row.tag,
        namespace: row.namespace,
        machineId: row.machine_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: safeJsonParse(row.metadata),
        metadataVersion: row.metadata_version,
        agentState: safeJsonParse(row.agent_state),
        agentStateVersion: row.agent_state_version,
        model: row.model,
        todos: safeJsonParse(row.todos),
        todosUpdatedAt: row.todos_updated_at,
        teamState: safeJsonParse(row.team_state),
        teamStateUpdatedAt: row.team_state_updated_at,
        active: row.active === 1,
        activeAt: row.active_at,
        seq: row.seq
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function getTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

function collectNativeSessionAliases(metadata: unknown): {
    hasAliasKeys: boolean
    aliases: NativeSessionAlias[]
} {
    if (!isRecord(metadata)) {
        return { hasAliasKeys: false, aliases: [] }
    }

    const hasAliasKeys = [
        'nativeProvider',
        'nativeSessionId',
        'claudeSessionId',
        'codexSessionId'
    ].some((key) => key in metadata)

    if (!hasAliasKeys) {
        return { hasAliasKeys: false, aliases: [] }
    }

    const aliasByProvider = new Map<NativeProvider, string>()

    const claudeSessionId = getTrimmedString(metadata.claudeSessionId)
    if (claudeSessionId) {
        aliasByProvider.set('claude', claudeSessionId)
    }

    const codexSessionId = getTrimmedString(metadata.codexSessionId)
    if (codexSessionId) {
        aliasByProvider.set('codex', codexSessionId)
    }

    const nativeProvider = metadata.nativeProvider
    const nativeSessionId = getTrimmedString(metadata.nativeSessionId)
    if ((nativeProvider === 'claude' || nativeProvider === 'codex') && nativeSessionId) {
        aliasByProvider.set(nativeProvider, nativeSessionId)
    }

    return {
        hasAliasKeys: true,
        aliases: Array.from(aliasByProvider.entries()).map(([provider, sessionId]) => ({
            provider,
            nativeSessionId: sessionId
        }))
    }
}

export function getOrCreateSession(
    db: Database,
    tag: string,
    metadata: unknown,
    agentState: unknown,
    namespace: string,
    model?: string
): StoredSession {
    const existing = db.prepare(
        'SELECT * FROM sessions WHERE tag = ? AND namespace = ? ORDER BY created_at DESC LIMIT 1'
    ).get(tag, namespace) as DbSessionRow | undefined

    if (existing) {
        return toStoredSession(existing)
    }

    const now = Date.now()
    const id = randomUUID()

    const metadataJson = JSON.stringify(metadata)
    const agentStateJson = agentState === null || agentState === undefined ? null : JSON.stringify(agentState)

    db.prepare(`
        INSERT INTO sessions (
            id, tag, namespace, machine_id, created_at, updated_at,
            metadata, metadata_version,
            agent_state, agent_state_version,
            model,
            todos, todos_updated_at,
            active, active_at, seq
        ) VALUES (
            @id, @tag, @namespace, NULL, @created_at, @updated_at,
            @metadata, 1,
            @agent_state, 1,
            @model,
            NULL, NULL,
            0, NULL, 0
        )
    `).run({
        id,
        tag,
        namespace,
        created_at: now,
        updated_at: now,
        metadata: metadataJson,
        agent_state: agentStateJson,
        model: model ?? null
    })

    const row = getSession(db, id)
    if (!row) {
        throw new Error('Failed to create session')
    }
    return row
}

export function updateSessionMetadata(
    db: Database,
    id: string,
    metadata: unknown,
    expectedVersion: number,
    namespace: string,
    _options?: { touchUpdatedAt?: boolean }
): VersionedUpdateResult<unknown | null> {
    return updateVersionedField({
        db,
        table: 'sessions',
        id,
        namespace,
        field: 'metadata',
        versionField: 'metadata_version',
        expectedVersion,
        value: metadata,
        encode: (value) => {
            const json = JSON.stringify(value)
            return json === undefined ? null : json
        },
        decode: safeJsonParse,
        setClauses: ['seq = seq + 1']
    })
}

export function updateSessionAgentState(
    db: Database,
    id: string,
    agentState: unknown,
    expectedVersion: number,
    namespace: string
): VersionedUpdateResult<unknown | null> {
    const normalized = agentState ?? null

    return updateVersionedField({
        db,
        table: 'sessions',
        id,
        namespace,
        field: 'agent_state',
        versionField: 'agent_state_version',
        expectedVersion,
        value: normalized,
        encode: (value) => (value === null ? null : JSON.stringify(value)),
        decode: safeJsonParse,
        setClauses: ['seq = seq + 1']
    })
}

export function setSessionTodos(
    db: Database,
    id: string,
    todos: unknown,
    todosUpdatedAt: number,
    namespace: string
): boolean {
    try {
        const json = todos === null || todos === undefined ? null : JSON.stringify(todos)
        const result = db.prepare(`
            UPDATE sessions
            SET todos = @todos,
                todos_updated_at = @todos_updated_at,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND (todos_updated_at IS NULL OR todos_updated_at < @todos_updated_at)
        `).run({
            id,
            todos: json,
            todos_updated_at: todosUpdatedAt,
            namespace
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function setSessionTeamState(
    db: Database,
    id: string,
    teamState: unknown,
    updatedAt: number,
    namespace: string
): boolean {
    try {
        const json = teamState === null || teamState === undefined ? null : JSON.stringify(teamState)
        const result = db.prepare(`
            UPDATE sessions
            SET team_state = @team_state,
                team_state_updated_at = @team_state_updated_at,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND (team_state_updated_at IS NULL OR team_state_updated_at < @team_state_updated_at)
        `).run({
            id,
            team_state: json,
            team_state_updated_at: updatedAt,
            namespace
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function setSessionModel(
    db: Database,
    id: string,
    model: string | null,
    namespace: string,
    options?: { touchUpdatedAt?: boolean }
): boolean {
    const now = Date.now()
    const touchUpdatedAt = options?.touchUpdatedAt === true

    try {
        const result = db.prepare(`
            UPDATE sessions
            SET model = @model,
                updated_at = CASE WHEN @touch_updated_at = 1 THEN @updated_at ELSE updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND model IS NOT @model
        `).run({
            id,
            namespace,
            model,
            updated_at: now,
            touch_updated_at: touchUpdatedAt ? 1 : 0
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function getSession(db: Database, id: string): StoredSession | null {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSessionByNamespace(db: Database, id: string, namespace: string): StoredSession | null {
    const row = db.prepare(
        'SELECT * FROM sessions WHERE id = ? AND namespace = ?'
    ).get(id, namespace) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSessions(db: Database): StoredSession[] {
    const rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function getSessionsByNamespace(db: Database, namespace: string): StoredSession[] {
    const rows = db.prepare(
        'SELECT * FROM sessions WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace) as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function getSessionByNativeAlias(
    db: Database,
    namespace: string,
    provider: NativeProvider,
    nativeSessionId: string
): StoredSession | null {
    const row = db.prepare(`
        SELECT s.*
        FROM session_native_aliases a
        JOIN sessions s ON s.id = a.session_id
        WHERE a.namespace = ?
          AND a.provider = ?
          AND a.native_session_id = ?
        LIMIT 1
    `).get(namespace, provider, nativeSessionId) as DbSessionRow | undefined

    return row ? toStoredSession(row) : null
}

export function syncNativeAliasesForSessionMetadata(
    db: Database,
    sessionId: string,
    namespace: string,
    metadata: unknown
): void {
    const session = getSessionByNamespace(db, sessionId, namespace)
    if (!session) {
        return
    }

    const { hasAliasKeys, aliases } = collectNativeSessionAliases(metadata)
    if (!hasAliasKeys) {
        return
    }

    db.prepare(`
        DELETE FROM session_native_aliases
        WHERE session_id = ?
          AND namespace = ?
    `).run(sessionId, namespace)

    if (aliases.length === 0) {
        return
    }

    const now = Date.now()
    const insertAlias = db.prepare(`
        INSERT INTO session_native_aliases (
            namespace,
            provider,
            native_session_id,
            session_id,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(namespace, provider, native_session_id) DO UPDATE SET
            session_id = excluded.session_id,
            updated_at = excluded.updated_at
    `)

    for (const alias of aliases) {
        insertAlias.run(namespace, alias.provider, alias.nativeSessionId, sessionId, now, now)
    }
}

export function reconcileSessionTimestamps(
    db: Database,
    id: string,
    namespace: string,
    payload: {
        createdAt: number
        lastActivityAt: number
    }
): StoredSession | null {
    const session = getSessionByNamespace(db, id, namespace)
    if (!session) {
        return null
    }

    const messageBounds = db.prepare(`
        SELECT MAX(created_at) AS max_created_at
        FROM messages
        WHERE session_id = ?
    `).get(id) as { max_created_at: number | null } | undefined

    const createdAt = payload.createdAt
    const updatedAt = Math.max(
        messageBounds?.max_created_at ?? payload.lastActivityAt ?? createdAt,
        payload.lastActivityAt ?? createdAt,
        createdAt
    )

    if (session.createdAt === createdAt && session.updatedAt === updatedAt) {
        return session
    }

    db.prepare(`
        UPDATE sessions
        SET created_at = @created_at,
            updated_at = @updated_at,
            seq = seq + 1
        WHERE id = @id
          AND namespace = @namespace
    `).run({
        id,
        namespace,
        created_at: createdAt,
        updated_at: updatedAt
    })

    return getSessionByNamespace(db, id, namespace)
}

export function deleteSession(db: Database, id: string, namespace: string): boolean {
    const result = db.prepare(
        'DELETE FROM sessions WHERE id = ? AND namespace = ?'
    ).run(id, namespace)
    return result.changes > 0
}
