import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Server } from 'socket.io'
import type { RawEventEnvelope } from '@hapi/protocol'

import { Store } from '../../store'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { SSEManager } from '../../sse/sseManager'
import { SyncEngine } from '../../sync/syncEngine'
import { VisibilityTracker } from '../../visibility/visibilityTracker'
import { createMessagesRoutes } from './messages'

function createEngine() {
    const store = new Store(':memory:')
    const io = {
        of: () => ({
            to: () => ({
                emit: () => undefined
            })
        })
    } as unknown as Server
    const rpcRegistry = new RpcRegistry()
    const sseManager = new SSEManager(0, new VisibilityTracker())
    const engine = new SyncEngine(store, io, rpcRegistry, sseManager)

    return { engine, sseManager }
}

function createApp(engine: SyncEngine) {
    const app = new Hono()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        return await next()
    })
    app.route('/', createMessagesRoutes(() => engine))
    return app
}

function createClaudeRawEvent(overrides: Partial<RawEventEnvelope> & Pick<RawEventEnvelope, 'id' | 'sessionId' | 'sourceKey' | 'occurredAt' | 'rawType' | 'payload'>): RawEventEnvelope {
    return {
        id: overrides.id,
        sessionId: overrides.sessionId,
        provider: 'claude',
        source: 'runtime',
        sourceSessionId: overrides.sessionId,
        sourceKey: overrides.sourceKey,
        observationKey: null,
        channel: 'runtime:session',
        sourceOrder: 0,
        occurredAt: overrides.occurredAt,
        ingestedAt: overrides.occurredAt + 1,
        rawType: overrides.rawType,
        payload: overrides.payload,
        ingestSchemaVersion: 1,
        ...overrides
    }
}

describe('messages routes', () => {
    it('returns canonical pages from GET /sessions/:id/messages', async () => {
        const { engine, sseManager } = createEngine()
        const app = createApp(engine)
        const session = engine.getOrCreateSession('tag:messages-route-1', {
            path: '/tmp/messages-route-1',
            host: 'local',
            source: 'hapi',
            flavor: 'claude'
        }, null, 'default')

        await engine.ingestRawEvents(session.id, [
            createClaudeRawEvent({
                id: 'raw-user',
                sessionId: session.id,
                sourceKey: 'evt:1',
                sourceOrder: 1,
                occurredAt: 100,
                rawType: 'user',
                payload: {
                    type: 'user',
                    sessionId: session.id,
                    cwd: '/tmp/messages-route-1',
                    timestamp: '2026-03-17T00:00:00.100Z',
                    message: { content: 'hello route' }
                }
            })
        ])

        const response = await app.request(`http://localhost/sessions/${encodeURIComponent(session.id)}/messages?limit=20`)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            items: [
                expect.objectContaining({
                    kind: 'user-text',
                    payload: expect.objectContaining({ text: 'hello route' })
                })
            ],
            page: expect.objectContaining({
                generation: 1,
                parserVersion: 1,
                latestStreamSeq: 1,
                limit: 20,
                beforeTimelineSeq: null,
                nextBeforeTimelineSeq: null,
                hasMore: false
            })
        })

        engine.stop()
        sseManager.stop()
    })

    it('returns 409 reset-required when client generation is stale', async () => {
        const { engine, sseManager } = createEngine()
        const app = createApp(engine)
        const session = engine.getOrCreateSession('tag:messages-route-2', {
            path: '/tmp/messages-route-2',
            host: 'local',
            source: 'hapi',
            flavor: 'claude'
        }, null, 'default')

        await engine.ingestRawEvents(session.id, [
            createClaudeRawEvent({
                id: 'raw-user',
                sessionId: session.id,
                sourceKey: 'evt:1',
                sourceOrder: 1,
                occurredAt: 100,
                rawType: 'user',
                payload: {
                    type: 'user',
                    sessionId: session.id,
                    cwd: '/tmp/messages-route-2',
                    timestamp: '2026-03-17T00:00:00.100Z',
                    message: { content: 'hello route' }
                }
            })
        ])
        await engine.rebuildSessionCanonicalState(session.id)

        const response = await app.request(`http://localhost/sessions/${encodeURIComponent(session.id)}/messages?generation=1&limit=20`)
        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            reset: true,
            generation: 2,
            parserVersion: 1
        })

        engine.stop()
        sseManager.stop()
    })
})
