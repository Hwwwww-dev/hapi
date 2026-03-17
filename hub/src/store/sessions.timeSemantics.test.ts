import { describe, expect, it } from 'bun:test'

import { Store } from './index'

describe('SessionStore time semantics', () => {
    it('uses provider createdAt/lastActivityAt when the session has no messages', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-time-empty',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        const reconciled = store.sessions.reconcileSessionTimestamps(session.id, 'default', {
            createdAt: 100,
            lastActivityAt: 150
        })

        expect(reconciled).toEqual(expect.objectContaining({
            createdAt: 100,
            updatedAt: 150
        }))
    })

    it('moves createdAt earlier when a later provider sync reports an earlier creation time', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-time-earlier-created-at',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        store.sessions.reconcileSessionTimestamps(session.id, 'default', {
            createdAt: 200,
            lastActivityAt: 250
        })
        const reconciled = store.sessions.reconcileSessionTimestamps(session.id, 'default', {
            createdAt: 100,
            lastActivityAt: 250
        })

        expect(reconciled).toEqual(expect.objectContaining({
            createdAt: 100,
            updatedAt: 250
        }))
    })

    it('is idempotent for repeated reconciliation with the same payload', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-time-idempotent',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        const first = store.sessions.reconcileSessionTimestamps(session.id, 'default', {
            createdAt: 100,
            lastActivityAt: 150
        })
        const second = store.sessions.reconcileSessionTimestamps(session.id, 'default', {
            createdAt: 100,
            lastActivityAt: 150
        })

        expect(second).toEqual(first)
        expect(second?.seq).toBe(first?.seq)
    })

    it('keeps updatedAt clamped to createdAt when lastActivityAt is older', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-time-clamp',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        const reconciled = store.sessions.reconcileSessionTimestamps(session.id, 'default', {
            createdAt: 200,
            lastActivityAt: 100
        })

        expect(reconciled).toEqual(expect.objectContaining({
            createdAt: 200,
            updatedAt: 200
        }))
    })

    it('does not let metadata, agent state, todos, or team state rewrite recency', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-time-bookkeeping',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        store.sessions.reconcileSessionTimestamps(session.id, 'default', {
            createdAt: 100,
            lastActivityAt: 150
        })
        const baseline = store.sessions.getSession(session.id)
        if (!baseline) {
            throw new Error('Missing baseline session')
        }

        const metadataResult = store.sessions.updateSessionMetadata(
            session.id,
            { path: '/tmp/project', host: 'local', name: 'renamed' },
            baseline.metadataVersion,
            'default'
        )
        expect(metadataResult.result).toBe('success')

        const afterMetadata = store.sessions.getSession(session.id)
        if (!afterMetadata) {
            throw new Error('Missing session after metadata update')
        }

        const agentStateResult = store.sessions.updateSessionAgentState(
            session.id,
            { requests: { req1: { tool: 'bash', arguments: {}, createdAt: 200 } } },
            afterMetadata.agentStateVersion,
            'default'
        )
        expect(agentStateResult.result).toBe('success')
        expect(store.sessions.setSessionTodos(session.id, [{ id: 'todo-1', content: 'x', status: 'pending', priority: 'high' }], 999, 'default')).toBe(true)
        expect(store.sessions.setSessionTeamState(session.id, { teamName: 'core' }, 1000, 'default')).toBe(true)

        const finalSession = store.sessions.getSession(session.id)
        expect(finalSession).toEqual(expect.objectContaining({
            createdAt: 100,
            updatedAt: 150
        }))
    })

    it('does not let alias synchronization rewrite recency', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-time-alias',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        store.sessions.reconcileSessionTimestamps(session.id, 'default', {
            createdAt: 100,
            lastActivityAt: 150
        })
        store.sessions.syncNativeAliasesForSessionMetadata(session.id, 'default', {
            path: '/tmp/project',
            host: 'local',
            nativeProvider: 'claude',
            nativeSessionId: 'native-1',
            claudeSessionId: 'native-1'
        })

        expect(store.sessions.getSession(session.id)).toEqual(expect.objectContaining({
            createdAt: 100,
            updatedAt: 150
        }))
    })

    it('does not let sync-state writes rewrite recency', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-time-sync-state',
            {
                path: '/tmp/project',
                host: 'local',
                source: 'native',
                nativeProvider: 'claude',
                nativeSessionId: 'native-1'
            },
            null,
            'default'
        )

        store.sessions.reconcileSessionTimestamps(session.id, 'default', {
            createdAt: 100,
            lastActivityAt: 150
        })
        store.nativeSyncState.upsert({
            sessionId: session.id,
            provider: 'claude',
            nativeSessionId: 'native-1',
            machineId: 'machine-1',
            cursor: '10',
            filePath: '/tmp/session.jsonl',
            mtime: 11,
            lastSyncedAt: 999,
            syncStatus: 'healthy',
            lastError: null
        })

        expect(store.sessions.getSession(session.id)).toEqual(expect.objectContaining({
            createdAt: 100,
            updatedAt: 150
        }))
    })
})
