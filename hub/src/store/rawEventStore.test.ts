import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { RawEventEnvelope } from '@hapi/protocol'

import { Store } from './index'

const tempDirs: string[] = []

function createRawEvent(overrides: Partial<RawEventEnvelope> = {}): RawEventEnvelope {
    return {
        id: 'raw-1',
        sessionId: 'session-1',
        provider: 'claude',
        source: 'runtime',
        sourceSessionId: 'native-session-1',
        sourceKey: 'line:1',
        observationKey: null,
        channel: 'chat',
        sourceOrder: 0,
        occurredAt: 100,
        ingestedAt: 200,
        rawType: 'assistant-message',
        payload: { role: 'assistant', content: 'hello' },
        ingestSchemaVersion: 1,
        ...overrides
    }
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (!dir) {
            continue
        }
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('RawEventStore', () => {
    it('deduplicates source identity and keeps runtime backfill ordered by ingest seq', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'raw-event-session-1',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        const first = store.rawEvents.ingest(createRawEvent({
            id: 'runtime-1',
            sessionId: session.id,
            sourceKey: 'line:1',
            sourceOrder: 1,
            occurredAt: 100,
            ingestedAt: 1000
        }))
        const duplicate = store.rawEvents.ingest(createRawEvent({
            id: 'runtime-1-duplicate',
            sessionId: session.id,
            sourceKey: 'line:1',
            sourceOrder: 999,
            occurredAt: 999,
            ingestedAt: 9999,
            payload: { role: 'assistant', content: 'ignored duplicate' }
        }))
        const native = store.rawEvents.ingest(createRawEvent({
            id: 'native-1',
            sessionId: session.id,
            source: 'native',
            sourceKey: 'native:1',
            sourceOrder: 1,
            occurredAt: 110,
            ingestedAt: 1010
        }))
        const runtimeLater = store.rawEvents.ingest(createRawEvent({
            id: 'runtime-2',
            sessionId: session.id,
            sourceKey: 'line:2',
            sourceOrder: 2,
            occurredAt: 120,
            ingestedAt: 1020
        }))

        expect(first.inserted).toBe(true)
        expect(duplicate.inserted).toBe(false)
        expect(native.inserted).toBe(true)
        expect(runtimeLater.inserted).toBe(true)
        expect(store.rawEvents.listBySession(session.id)).toHaveLength(3)
        expect(store.rawEvents.listBySession(session.id).map((row) => row.ingestSeq)).toEqual([1, 2, 3])
        expect(store.rawEvents.listBySession(session.id)[0]?.id).toBe('runtime-1')
        expect(store.rawEvents.listRuntimeAfterIngestSeq(session.id, 0).map((row) => row.id)).toEqual([
            'runtime-1',
            'runtime-2'
        ])
        expect(store.rawEvents.listRuntimeAfterIngestSeq(session.id, 1).map((row) => row.id)).toEqual([
            'runtime-2'
        ])
    })

    it('replays parser input by spec raw sort key instead of ingest order and exposes a stable sort key', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'raw-event-session-2',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        store.rawEvents.ingest(createRawEvent({
            id: 'later',
            sessionId: session.id,
            sourceKey: 'line:2',
            sourceOrder: 2,
            occurredAt: 200,
            ingestedAt: 1000
        }))
        store.rawEvents.ingest(createRawEvent({
            id: 'earlier',
            sessionId: session.id,
            sourceKey: 'line:1',
            sourceOrder: 1,
            occurredAt: 100,
            ingestedAt: 2000
        }))

        expect(store.rawEvents.listBySession(session.id).map((row) => row.id)).toEqual([
            'later',
            'earlier'
        ])

        const replayRows = store.rawEvents.listForParserReplay(session.id)

        expect(replayRows.map((row) => row.id)).toEqual(['earlier', 'later'])
        expect(replayRows[0]).toMatchObject({
            id: 'earlier',
            occurredAt: 100,
            source: 'runtime',
            channel: 'chat',
            sourceOrder: 1,
            sourceKey: 'line:1'
        })
        expect(replayRows[0]?.sortKey).toEqual(expect.any(String))
        expect(replayRows[1]?.sortKey).toEqual(expect.any(String))
        expect((replayRows[0]?.sortKey ?? '') < (replayRows[1]?.sortKey ?? '')).toBe(true)
    })

    it('fails fast on pre-canonical schema versions with a reset error', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-raw-events-schema-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'store.sqlite')

        const db = new Database(dbPath, { create: true, readwrite: true })
        db.exec('PRAGMA user_version = 6')
        db.close()

        expect(() => new Store(dbPath)).toThrow(/reset|rebuild|delete/i)
    })
})
