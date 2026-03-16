import { describe, expect, it } from 'bun:test'

import type { RawEventEnvelope } from '@hapi/protocol'

import { Store } from './index'

function createStagedChildPayload(overrides: Partial<Omit<RawEventEnvelope, 'sessionId'>> = {}): Omit<RawEventEnvelope, 'sessionId'> {
    return {
        id: 'child-raw-1',
        provider: 'claude',
        source: 'runtime',
        sourceSessionId: 'child-source-session-1',
        sourceKey: 'line:1',
        observationKey: null,
        channel: 'chat',
        sourceOrder: 0,
        occurredAt: 100,
        ingestedAt: 200,
        rawType: 'assistant-message',
        payload: { role: 'assistant', content: 'hello from child' },
        ingestSchemaVersion: 1,
        ...overrides
    }
}

describe('StagedChildRawEventStore', () => {
    it('rehomes staged child rows into raw_events for the target parent session', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'parent-session-1',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        store.stagedChildRawEvents.stage({
            id: 'child-raw-1',
            provider: 'claude',
            childIdentity: 'agent-1',
            payload: createStagedChildPayload(),
            stagedAt: 1000
        })
        store.stagedChildRawEvents.stage({
            id: 'child-raw-2',
            provider: 'claude',
            childIdentity: 'agent-1',
            payload: createStagedChildPayload({
                id: 'child-raw-2',
                sourceKey: 'line:2',
                sourceOrder: 1,
                occurredAt: 110,
                ingestedAt: 210
            }),
            stagedAt: 1010
        })

        store.stagedChildRawEvents.rehomeToSession({ childIdentity: 'agent-1', sessionId: session.id })

        expect(store.stagedChildRawEvents.listAll()).toHaveLength(0)
        expect(store.rawEvents.listBySession(session.id).map((event) => event.id)).toEqual([
            'child-raw-1',
            'child-raw-2'
        ])
        expect(store.rawEvents.listBySession(session.id)[0]?.sessionId).toBe(session.id)
    })

    it('rolls back staged rehome when the destination session is missing', () => {
        const store = new Store(':memory:')

        store.stagedChildRawEvents.stage({
            id: 'child-raw-rollback',
            provider: 'claude',
            childIdentity: 'agent-1',
            payload: createStagedChildPayload({ id: 'child-raw-rollback' }),
            stagedAt: 1000
        })

        expect(() => {
            store.stagedChildRawEvents.rehomeToSession({
                childIdentity: 'agent-1',
                sessionId: 'missing-session'
            })
        }).toThrow()

        expect(store.stagedChildRawEvents.listAll().map((event) => event.id)).toEqual(['child-raw-rollback'])
        expect(store.rawEvents.listBySession('missing-session')).toHaveLength(0)
    })

    it('deletes staged child rows by child identity without touching other rows', () => {
        const store = new Store(':memory:')

        store.stagedChildRawEvents.stage({
            id: 'child-raw-a',
            provider: 'claude',
            childIdentity: 'agent-1',
            payload: createStagedChildPayload({ id: 'child-raw-a' }),
            stagedAt: 1000
        })
        store.stagedChildRawEvents.stage({
            id: 'child-raw-b',
            provider: 'claude',
            childIdentity: 'agent-2',
            payload: createStagedChildPayload({ id: 'child-raw-b', sourceKey: 'line:2' }),
            stagedAt: 1010
        })

        expect(store.stagedChildRawEvents.deleteByChildIdentity('agent-1')).toBe(1)
        expect(store.stagedChildRawEvents.listAll().map((event) => event.id)).toEqual(['child-raw-b'])
    })
})
