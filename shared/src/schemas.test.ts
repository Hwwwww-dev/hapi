import { describe, expect, it } from 'vitest'

import type { CanonicalRootBlock } from './canonical'
import { RuntimeRawEventPayloadSchema } from './socket'
import { MetadataSchema, SyncEventSchema } from './schemas'

function createCanonicalRoot(): CanonicalRootBlock {
    return {
        id: 'root-1',
        sessionId: 'session-1',
        timelineSeq: 1,
        siblingSeq: 0,
        parentBlockId: null,
        rootBlockId: 'root-1',
        depth: 0,
        kind: 'reasoning',
        createdAt: 1,
        updatedAt: 2,
        state: 'streaming',
        payload: { text: 'thinking...' },
        sourceRawEventIds: ['raw-1'],
        parserVersion: 1,
        generation: 2,
        children: []
    }
}

describe('MetadataSchema', () => {
    it('parses native session metadata fields and preserves existing fields', () => {
        const metadata = {
            path: '/tmp/project',
            host: 'local',
            name: 'demo-session',
            codexSessionId: 'codex-existing-session',
            source: 'native' as const,
            nativeProvider: 'codex' as const,
            nativeSessionId: 'native-session-123',
            nativeProjectPath: '/tmp/project',
            nativeDiscoveredAt: 1710000000000,
            nativeLastSyncedAt: 1710000005000
        }

        expect(MetadataSchema.parse(metadata)).toEqual(metadata)
    })

    it('keeps native session metadata fields optional', () => {
        const metadata = {
            path: '/tmp/project',
            host: 'local',
            name: 'demo-session'
        }

        expect(MetadataSchema.parse(metadata)).toEqual(metadata)
    })
})

describe('SyncEventSchema', () => {
    it('accepts canonical root upsert events', () => {
        const root = createCanonicalRoot()

        expect(SyncEventSchema.parse({
            type: 'canonical-root-upsert',
            sessionId: 'session-1',
            generation: 2,
            parserVersion: 1,
            streamSeq: 7,
            op: 'append',
            root
        })).toEqual(expect.objectContaining({
            type: 'canonical-root-upsert',
            root
        }))
    })

    it('accepts canonical reset events', () => {
        expect(SyncEventSchema.parse({
            type: 'canonical-reset',
            sessionId: 'session-1',
            generation: 2,
            parserVersion: 1,
            streamSeq: 8,
            reason: 'rebuild'
        })).toEqual(expect.objectContaining({
            type: 'canonical-reset',
            reason: 'rebuild'
        }))
    })

    it('keeps legacy message-received events working', () => {
        expect(SyncEventSchema.parse({
            type: 'message-received',
            sessionId: 'session-1',
            message: {
                id: 'message-1',
                seq: 1,
                localId: null,
                content: { role: 'assistant', content: 'hello' },
                createdAt: 1
            }
        })).toEqual(expect.objectContaining({
            type: 'message-received',
            sessionId: 'session-1'
        }))
    })
})

describe('RuntimeRawEventPayloadSchema', () => {
    it('requires the additive runtime raw-envelope contract', () => {
        const payload = RuntimeRawEventPayloadSchema.parse({
            sid: 'session-1',
            event: {
                id: 'raw-1',
                provider: 'claude',
                source: 'runtime',
                sourceSessionId: 'provider-session-1',
                sourceKey: 'event-1',
                observationKey: null,
                channel: 'runtime:messages',
                sourceOrder: 0,
                occurredAt: 1,
                ingestedAt: 2,
                rawType: 'assistant-message',
                payload: { role: 'assistant', content: 'hello' },
                ingestSchemaVersion: 1
            }
        })

        expect(payload.event.source).toBe('runtime')
        expect(payload.sid).toBe('session-1')
    })

    it('rejects runtime raw events without source identity fields', () => {
        expect(() => RuntimeRawEventPayloadSchema.parse({
            sid: 'session-1',
            event: {
                id: 'raw-1',
                provider: 'claude',
                source: 'runtime',
                sourceSessionId: 'provider-session-1',
                observationKey: null,
                channel: 'runtime:messages',
                sourceOrder: 0,
                occurredAt: 1,
                ingestedAt: 2,
                rawType: 'assistant-message',
                payload: { role: 'assistant', content: 'hello' },
                ingestSchemaVersion: 1
            }
        })).toThrow(/sourceKey/i)
    })
})
