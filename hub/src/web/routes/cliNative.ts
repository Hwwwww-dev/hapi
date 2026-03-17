import { Hono } from 'hono'
import { RawEventEnvelopeSchema } from '@hapi/protocol'
import { z } from 'zod'

import type { SyncEngine } from '../../sync/syncEngine'

type CliEnv = {
    Variables: {
        namespace: string
    }
}

const nativeSessionUpsertSchema = z.object({
    tag: z.string().min(1),
    metadata: z.unknown(),
    createdAt: z.number().finite().positive(),
    lastActivityAt: z.number().finite().positive(),
    agentState: z.unknown().nullable().optional()
}).refine((value) => value.lastActivityAt >= value.createdAt, {
    message: 'lastActivityAt must be >= createdAt',
    path: ['lastActivityAt']
})

const nativeRawEventImportSchema = z.object({
    events: z.array(RawEventEnvelopeSchema)
})

const nativeSyncStateSchema = z.object({
    provider: z.enum(['claude', 'codex']),
    nativeSessionId: z.string().min(1),
    machineId: z.string().min(1),
    cursor: z.string().nullable().optional(),
    filePath: z.string().nullable().optional(),
    mtime: z.number().nullable().optional(),
    lastSyncedAt: z.number().nullable().optional(),
    syncStatus: z.enum(['healthy', 'error']),
    lastError: z.string().nullable().optional()
})

function resolveSessionForNamespace(
    engine: SyncEngine,
    sessionId: string,
    namespace: string
): { ok: true; sessionId: string } | { ok: false; status: 403 | 404; error: string } {
    const access = engine.resolveSessionAccess(sessionId, namespace)
    if (access.ok) {
        return { ok: true, sessionId: access.sessionId }
    }
    return {
        ok: false,
        status: access.reason === 'access-denied' ? 403 : 404,
        error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
    }
}

export function createCliNativeRoutes(getSyncEngine: () => SyncEngine | null): Hono<CliEnv> {
    const app = new Hono<CliEnv>()

    app.post('/sessions/upsert', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = nativeSessionUpsertSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const session = engine.upsertNativeSession({
            tag: parsed.data.tag,
            metadata: parsed.data.metadata,
            createdAt: parsed.data.createdAt,
            lastActivityAt: parsed.data.lastActivityAt,
            agentState: parsed.data.agentState ?? null,
            namespace: c.get('namespace')
        })

        return c.json({ session })
    })

    app.post('/sessions/:id/raw-events/import', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, c.req.param('id'), namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = nativeRawEventImportSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const result = await engine.ingestRawEvents(
            resolved.sessionId,
            parsed.data.events.map((event) => ({
                ...event,
                sessionId: resolved.sessionId
            }))
        )
        const session = engine.getSession(resolved.sessionId)
        if (!session) {
            return c.json({ error: 'Session not found' }, 404)
        }

        return c.json({
            imported: result.imported,
            session
        })
    })

    app.get('/sessions/:id/sync-state', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, c.req.param('id'), namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        return c.json({ state: engine.getNativeSyncState(resolved.sessionId) })
    })

    app.post('/sessions/:id/sync-state', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, c.req.param('id'), namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = nativeSyncStateSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const result = engine.updateNativeSyncState({
            sessionId: resolved.sessionId,
            provider: parsed.data.provider,
            nativeSessionId: parsed.data.nativeSessionId,
            machineId: parsed.data.machineId,
            cursor: parsed.data.cursor ?? null,
            filePath: parsed.data.filePath ?? null,
            mtime: parsed.data.mtime ?? null,
            lastSyncedAt: parsed.data.lastSyncedAt ?? null,
            syncStatus: parsed.data.syncStatus,
            lastError: parsed.data.lastError ?? null
        })

        if (!result.ok) {
            return c.json({ error: result.error }, result.status)
        }

        return c.json({ state: result.state })
    })

    return app
}
