import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (!dir) {
            continue
        }
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('NativeSyncStateStore', () => {
    it('persists sync state across store instances', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-native-sync-state-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'store.sqlite')

        const firstStore = new Store(dbPath)
        const session = firstStore.sessions.getOrCreateSession(
            'native-sync-session-1',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )
        firstStore.nativeSyncState.upsert({
            sessionId: session.id,
            provider: 'claude',
            nativeSessionId: 'native-1',
            machineId: 'machine-1',
            cursor: '42',
            filePath: '/tmp/session.jsonl',
            mtime: 1234,
            lastSyncedAt: 5678,
            syncStatus: 'healthy',
            lastError: null
        })

        const secondStore = new Store(dbPath)
        expect(secondStore.nativeSyncState.getBySessionId(session.id)).toEqual({
            sessionId: session.id,
            provider: 'claude',
            nativeSessionId: 'native-1',
            machineId: 'machine-1',
            cursor: '42',
            filePath: '/tmp/session.jsonl',
            mtime: 1234,
            lastSyncedAt: 5678,
            syncStatus: 'healthy',
            lastError: null
        })
    })

    it('marks sync errors without dropping cursor state', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-sync-session-2',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )
        store.nativeSyncState.upsert({
            sessionId: session.id,
            provider: 'codex',
            nativeSessionId: 'native-2',
            machineId: 'machine-2',
            cursor: '99',
            filePath: '/tmp/codex.jsonl',
            mtime: 888,
            lastSyncedAt: 777,
            syncStatus: 'healthy',
            lastError: null
        })

        store.nativeSyncState.markError(session.id, 'tail failed', 999)

        expect(store.nativeSyncState.getBySessionId(session.id)).toEqual({
            sessionId: session.id,
            provider: 'codex',
            nativeSessionId: 'native-2',
            machineId: 'machine-2',
            cursor: '99',
            filePath: '/tmp/codex.jsonl',
            mtime: 888,
            lastSyncedAt: 999,
            syncStatus: 'error',
            lastError: 'tail failed'
        })
    })
})
