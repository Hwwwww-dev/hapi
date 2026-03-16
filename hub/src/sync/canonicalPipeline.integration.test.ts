import { describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'
import type { RawEventEnvelope } from '@hapi/protocol'

import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SSEManager } from '../sse/sseManager'
import { SyncEngine } from './syncEngine'
import { VisibilityTracker } from '../visibility/visibilityTracker'

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

function createSession(engine: SyncEngine, sessionId: string) {
    return engine.getOrCreateSession(`tag:${sessionId}`, {
        path: `/tmp/${sessionId}`,
        host: 'local',
        source: 'hapi',
        flavor: 'claude'
    }, null, 'default')
}

function createClaudeRawEvent(overrides: Partial<RawEventEnvelope> & Pick<RawEventEnvelope, 'id' | 'sessionId' | 'sourceKey' | 'occurredAt' | 'rawType' | 'payload'>): RawEventEnvelope {
    const {
        id,
        sessionId,
        sourceKey,
        occurredAt,
        rawType,
        payload,
        ...rest
    } = overrides

    return {
        ...rest,
        id,
        sessionId,
        provider: 'claude',
        source: 'runtime',
        sourceSessionId: sessionId,
        sourceKey,
        observationKey: null,
        channel: 'runtime:session',
        sourceOrder: 0,
        occurredAt,
        ingestedAt: occurredAt + 1,
        rawType,
        payload,
        ingestSchemaVersion: 1
    }
}

describe('canonical pipeline integration', () => {
    it('ingests raw events, exposes canonical page, and rebuild converges to the same roots', async () => {
        const { engine, sseManager } = createEngine()
        const session = createSession(engine, 'session-canonical-1')

        const events: RawEventEnvelope[] = [
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
                    cwd: '/tmp/session-canonical-1',
                    timestamp: '2026-03-17T00:00:00.100Z',
                    message: {
                        content: 'hello canonical'
                    }
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
                    cwd: '/tmp/session-canonical-1',
                    timestamp: '2026-03-17T00:00:00.200Z',
                    message: {
                        content: 'world canonical'
                    }
                }
            })
        ]

        const initial = await (engine as any).ingestRawEvents(session.id, events)
        expect(initial).toEqual(expect.objectContaining({
            imported: 2,
            activeGeneration: 1,
            parserVersion: 1
        }))

        const initialPage = (engine as any).getCanonicalMessagesPage(session.id, {
            generation: null,
            beforeTimelineSeq: null,
            limit: 50
        })
        expect(initialPage.page).toEqual(expect.objectContaining({
            generation: 1,
            parserVersion: 1,
            latestStreamSeq: 2
        }))
        expect(initialPage.items.map((item: { kind: string }) => item.kind)).toEqual(['user-text', 'agent-text'])
        expect(initialPage.items.map((item: { payload: { text: string } }) => item.payload.text)).toEqual([
            'hello canonical',
            'world canonical'
        ])

        const rebuilt = await (engine as any).rebuildSessionCanonicalState(session.id)
        expect(rebuilt).toEqual(expect.objectContaining({
            activeGeneration: 2,
            parserVersion: 1
        }))

        const rebuiltPage = (engine as any).getCanonicalMessagesPage(session.id, {
            generation: rebuilt.activeGeneration,
            beforeTimelineSeq: null,
            limit: 50
        })
        expect(rebuiltPage.items).toEqual(initialPage.items.map((item: any) => ({
            ...item,
            generation: rebuilt.activeGeneration,
            parserVersion: rebuilt.parserVersion
        })))

        engine.stop()
        sseManager.stop()
    })

    it('late earlier raw events trigger rebuild into a new generation', async () => {
        const { engine, sseManager } = createEngine()
        const session = createSession(engine, 'session-canonical-2')

        await (engine as any).ingestRawEvents(session.id, [
            createClaudeRawEvent({
                id: 'raw-assistant-only',
                sessionId: session.id,
                sourceKey: 'evt:2',
                sourceOrder: 2,
                occurredAt: 200,
                rawType: 'assistant',
                payload: {
                    type: 'assistant',
                    sessionId: session.id,
                    cwd: '/tmp/session-canonical-2',
                    timestamp: '2026-03-17T00:00:00.200Z',
                    message: {
                        content: 'second message'
                    }
                }
            })
        ])

        const lateResult = await (engine as any).ingestRawEvents(session.id, [
            createClaudeRawEvent({
                id: 'raw-late-user',
                sessionId: session.id,
                sourceKey: 'evt:1',
                sourceOrder: 1,
                occurredAt: 100,
                rawType: 'user',
                payload: {
                    type: 'user',
                    sessionId: session.id,
                    cwd: '/tmp/session-canonical-2',
                    timestamp: '2026-03-17T00:00:00.100Z',
                    message: {
                        content: 'first message'
                    }
                }
            })
        ])

        expect(lateResult).toEqual(expect.objectContaining({
            imported: 1,
            activeGeneration: 2,
            resetReason: 'late-earlier-event'
        }))

        const page = (engine as any).getCanonicalMessagesPage(session.id, {
            generation: null,
            beforeTimelineSeq: null,
            limit: 50
        })
        expect(page.page.generation).toBe(2)
        expect(page.items.map((item: { payload: { text: string } }) => item.payload.text)).toEqual([
            'first message',
            'second message'
        ])

        engine.stop()
        sseManager.stop()
    })
})
