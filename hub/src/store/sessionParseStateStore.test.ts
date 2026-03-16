import { describe, expect, it } from 'bun:test'

import { Store } from './index'


describe('SessionParseStateStore', () => {
    it('stores parser version, generation cursor, and rebuild bookkeeping', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'parse-state-session-1',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        const persisted = store.sessionParseState.upsert({
            sessionId: session.id,
            parserVersion: 2,
            activeGeneration: 3,
            state: {
                openToolCalls: { toolA: 'running' },
                observationRoots: { 'obs-1': 'root-1' }
            },
            lastProcessedRawSortKey: '00000000000000000100|00000000000000000001',
            lastProcessedRawEventId: 'raw-9',
            latestStreamSeq: 12,
            rebuildRequired: true,
            lastRebuildStartedAt: 1000,
            lastRebuildCompletedAt: null
        })

        expect(persisted).toEqual({
            sessionId: session.id,
            parserVersion: 2,
            activeGeneration: 3,
            state: {
                openToolCalls: { toolA: 'running' },
                observationRoots: { 'obs-1': 'root-1' }
            },
            lastProcessedRawSortKey: '00000000000000000100|00000000000000000001',
            lastProcessedRawEventId: 'raw-9',
            latestStreamSeq: 12,
            rebuildRequired: true,
            lastRebuildStartedAt: 1000,
            lastRebuildCompletedAt: null
        })

        store.sessionParseState.upsert({
            ...persisted,
            activeGeneration: 4,
            state: {
                openToolCalls: {},
                observationRoots: { 'obs-1': 'root-1', 'obs-2': 'root-2' }
            },
            latestStreamSeq: 15,
            rebuildRequired: false,
            lastRebuildCompletedAt: 1200
        })

        expect(store.sessionParseState.getBySessionId(session.id)).toEqual({
            sessionId: session.id,
            parserVersion: 2,
            activeGeneration: 4,
            state: {
                openToolCalls: {},
                observationRoots: { 'obs-1': 'root-1', 'obs-2': 'root-2' }
            },
            lastProcessedRawSortKey: '00000000000000000100|00000000000000000001',
            lastProcessedRawEventId: 'raw-9',
            latestStreamSeq: 15,
            rebuildRequired: false,
            lastRebuildStartedAt: 1000,
            lastRebuildCompletedAt: 1200
        })
    })
})
