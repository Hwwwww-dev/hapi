import { describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'
import type { RawEventEnvelope } from '@hapi/protocol'

import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SSEManager } from '../sse/sseManager'
import { SyncEngine } from '../sync/syncEngine'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import { rebuildSessionCanonicalState } from './rebuild'

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

    return { store, engine, sseManager }
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

describe('rebuildSessionCanonicalState', () => {
    it('rebuilds a fresh generation from stored raw events deterministically', async () => {
        const { store, engine, sseManager } = createEngine()
        const session = engine.getOrCreateSession('tag:rebuild-1', {
            path: '/tmp/rebuild-1',
            host: 'local',
            source: 'hapi',
            flavor: 'claude'
        }, null, 'default')

        for (const event of [
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
                    cwd: '/tmp/rebuild-1',
                    timestamp: '2026-03-17T00:00:00.100Z',
                    message: { content: 'hello rebuild' }
                }
            }),
            createClaudeRawEvent({
                id: 'raw-assistant',
                sessionId: session.id,
                sourceKey: 'evt:2',
                sourceOrder: 2,
                occurredAt: 200,
                rawType: 'assistant',
                payload: {
                    type: 'assistant',
                    sessionId: session.id,
                    cwd: '/tmp/rebuild-1',
                    timestamp: '2026-03-17T00:00:00.200Z',
                    message: { content: 'world rebuild' }
                }
            })
        ]) {
            store.rawEvents.ingest(event)
        }

        const rebuilt = await rebuildSessionCanonicalState({
            store,
            sessionId: session.id,
            parserVersion: 1,
            now: () => 999
        })

        expect(rebuilt).toEqual(expect.objectContaining({
            activeGeneration: 1,
            parserVersion: 1,
            latestStreamSeq: 1,
            roots: expect.arrayContaining([
                expect.objectContaining({ kind: 'user-text' }),
                expect.objectContaining({ kind: 'agent-text' })
            ])
        }))

        const parseState = store.sessionParseState.getBySessionId(session.id)
        expect(parseState).toEqual(expect.objectContaining({
            activeGeneration: 1,
            parserVersion: 1,
            rebuildRequired: false,
            latestStreamSeq: 1,
            lastRebuildStartedAt: 999,
            lastRebuildCompletedAt: 999
        }))

        engine.stop()
        sseManager.stop()
    })
})
