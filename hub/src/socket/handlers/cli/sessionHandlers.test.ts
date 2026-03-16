import { describe, expect, it } from 'bun:test'
import type { RawEventEnvelope } from '@hapi/protocol'

import { Store } from '../../../store'
import type { CliSocketWithData } from '../../socketTypes'
import { registerSessionHandlers } from './sessionHandlers'

function createRuntimeRawEvent(sessionId: string, overrides: Partial<RawEventEnvelope> = {}): RawEventEnvelope {
    return {
        id: 'runtime-raw-1',
        sessionId,
        provider: 'claude',
        source: 'runtime',
        sourceSessionId: sessionId,
        sourceKey: 'runtime:1',
        observationKey: null,
        channel: 'claude:runtime:messages',
        sourceOrder: 1,
        occurredAt: 100,
        ingestedAt: 101,
        rawType: 'user',
        payload: {
            type: 'user',
            sessionId,
            cwd: '/tmp/runtime-handler',
            timestamp: '2026-03-17T00:00:00.100Z',
            message: {
                content: 'hello from runtime handler'
            },
            localId: 'local-runtime-1',
            meta: {
                sentFrom: 'webapp'
            }
        },
        ingestSchemaVersion: 1,
        ...overrides
    }
}

function createFakeSocket(): {
    socket: CliSocketWithData
    getHandler: (event: string) => (...args: any[]) => any
} {
    const handlers = new Map<string, (...args: any[]) => any>()

    const socket = {
        data: { namespace: 'default' },
        handshake: { auth: {} },
        on(event: string, handler: (...args: any[]) => any) {
            handlers.set(event, handler)
            return this
        },
        emit() {
            return true
        },
        to() {
            return {
                emit() {
                    return true
                }
            }
        }
    } as unknown as CliSocketWithData

    return {
        socket,
        getHandler(event: string) {
            const handler = handlers.get(event)
            if (!handler) {
                throw new Error(`Missing socket handler for ${event}`)
            }
            return handler
        }
    }
}

describe('registerSessionHandlers runtime-event', () => {
    it('ingests runtime raw events into canonical state', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('tag:runtime-handler', {
            path: '/tmp/runtime-handler',
            host: 'local',
            source: 'hapi',
            flavor: 'claude'
        }, null, 'default')
        const seenEvents: unknown[] = []
        const fake = createFakeSocket()

        registerSessionHandlers(fake.socket, {
            store,
            resolveSessionAccess: (sessionId) => {
                const resolved = store.sessions.getSessionByNamespace(sessionId, 'default')
                return resolved ? { ok: true, value: resolved } : { ok: false, reason: 'not-found' }
            },
            emitAccessError: () => undefined,
            onWebappEvent: (event) => {
                seenEvents.push(event)
            }
        })

        await fake.getHandler('runtime-event')({
            sid: session.id,
            event: createRuntimeRawEvent(session.id)
        })

        const rawEvents = store.rawEvents.listBySession(session.id)
        expect(rawEvents).toHaveLength(1)
        expect(rawEvents[0]?.id).toBe('runtime-raw-1')

        const parseState = store.sessionParseState.getBySessionId(session.id)
        expect(parseState).toEqual(expect.objectContaining({
            activeGeneration: 1,
            latestStreamSeq: 1,
            parserVersion: 1
        }))

        const canonicalPage = store.canonicalBlocks.getRootsPage(session.id, {
            generation: 1,
            beforeTimelineSeq: null,
            limit: 20
        })
        expect(canonicalPage.items).toHaveLength(1)
        expect(canonicalPage.items[0]).toEqual(expect.objectContaining({
            kind: 'user-text',
            payload: expect.objectContaining({ text: 'hello from runtime handler' })
        }))
        expect(seenEvents).toContainEqual(expect.objectContaining({
            type: 'session-updated',
            sessionId: session.id
        }))
    })

    it('delegates runtime raw ingest to the higher-level callback when provided', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('tag:runtime-handler-delegated', {
            path: '/tmp/runtime-handler-delegated',
            host: 'local',
            source: 'hapi',
            flavor: 'claude'
        }, null, 'default')
        const seenEvents: unknown[] = []
        const fake = createFakeSocket()
        const calls: Array<{ sessionId: string; events: RawEventEnvelope[] }> = []

        registerSessionHandlers(fake.socket, {
            store,
            resolveSessionAccess: (sessionId) => {
                const resolved = store.sessions.getSessionByNamespace(sessionId, 'default')
                return resolved ? { ok: true, value: resolved } : { ok: false, reason: 'not-found' }
            },
            emitAccessError: () => undefined,
            ingestRawEvents: async (sessionId, events) => {
                calls.push({ sessionId, events })
                return { imported: 1 }
            },
            onWebappEvent: (event) => {
                seenEvents.push(event)
            }
        })

        await fake.getHandler('runtime-event')({
            sid: session.id,
            event: createRuntimeRawEvent(session.id)
        })

        expect(calls).toHaveLength(1)
        expect(calls[0]?.sessionId).toBe(session.id)
        expect(calls[0]?.events).toHaveLength(1)
        expect(calls[0]?.events[0]).toEqual(expect.objectContaining({
            id: 'runtime-raw-1',
            sessionId: session.id
        }))
        expect(store.rawEvents.listBySession(session.id)).toHaveLength(0)
        expect(seenEvents).toHaveLength(0)
    })
})
