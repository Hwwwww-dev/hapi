import { describe, expect, it } from 'vitest'

import {
    CanonicalMessagesPageSchema,
    CanonicalRootBlockSchema,
    RawEventEnvelopeSchema
} from './canonical'

function createRawEventEnvelope(overrides: Record<string, unknown> = {}) {
    return {
        id: 'raw-1',
        sessionId: 'session-1',
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
        ingestSchemaVersion: 1,
        ...overrides
    }
}

function createCanonicalRoot(overrides: Record<string, unknown> = {}) {
    const id = typeof overrides.id === 'string' ? overrides.id : 'root-1'

    return {
        id,
        sessionId: 'session-1',
        timelineSeq: 1,
        siblingSeq: 0,
        parentBlockId: null,
        rootBlockId: id,
        depth: 0,
        kind: 'reasoning',
        createdAt: 1,
        updatedAt: 2,
        state: 'streaming',
        payload: { text: 'thinking...' },
        sourceRawEventIds: ['raw-1'],
        parserVersion: 1,
        generation: 3,
        children: [],
        ...overrides
    }
}

function createCanonicalChild(overrides: Record<string, unknown> = {}) {
    return {
        id: 'child-1',
        sessionId: 'session-1',
        timelineSeq: 1,
        siblingSeq: 0,
        parentBlockId: 'root-1',
        rootBlockId: 'root-1',
        depth: 1,
        kind: 'agent-text',
        createdAt: 2,
        updatedAt: 3,
        state: 'complete',
        payload: { text: 'done' },
        sourceRawEventIds: ['raw-2'],
        parserVersion: 1,
        generation: 3,
        children: [],
        ...overrides
    }
}

describe('RawEventEnvelopeSchema', () => {
    it('accepts the v1 raw event contract', () => {
        const envelope = RawEventEnvelopeSchema.parse(createRawEventEnvelope())

        expect(envelope.sourceOrder).toBe(0)
        expect(envelope.provider).toBe('claude')
    })

    it('rejects raw events without ordering fields', () => {
        const { sourceOrder: _sourceOrder, ...invalidEnvelope } = createRawEventEnvelope()

        expect(() => RawEventEnvelopeSchema.parse(invalidEnvelope)).toThrow(/sourceOrder/i)
    })
})

describe('CanonicalRootBlockSchema', () => {
    it('accepts a canonical root tree with nested children', () => {
        const root = CanonicalRootBlockSchema.parse(createCanonicalRoot({
            children: [
                createCanonicalChild(),
                createCanonicalChild({
                    id: 'child-2',
                    siblingSeq: 1,
                    kind: 'event',
                    payload: { subtype: 'plan-updated', summary: 'todo changed' },
                    sourceRawEventIds: ['raw-3']
                })
            ]
        }))

        expect(root.children).toHaveLength(2)
        expect(root.children[1]?.kind).toBe('event')
    })

    it('rejects canonical roots without required ordering fields', () => {
        const { timelineSeq: _timelineSeq, ...invalidRoot } = createCanonicalRoot()

        expect(() => CanonicalRootBlockSchema.parse(invalidRoot)).toThrow(/timelineSeq/i)
    })

    it('rejects broken parent-child links in the canonical tree', () => {
        const invalidRoot = createCanonicalRoot({
            children: [createCanonicalChild({ parentBlockId: 'other-root' })]
        })

        expect(() => CanonicalRootBlockSchema.parse(invalidRoot)).toThrow(/parentBlockId/i)
    })

    it('rejects unknown closed event subtypes', () => {
        const invalidRoot = createCanonicalRoot({
            kind: 'event',
            payload: { subtype: 'unsupported-event' }
        })

        expect(() => CanonicalRootBlockSchema.parse(invalidRoot)).toThrow(/subtype/i)
    })
})

describe('CanonicalMessagesPageSchema', () => {
    it('accepts canonical page payloads', () => {
        const page = CanonicalMessagesPageSchema.parse({
            items: [createCanonicalRoot()],
            page: {
                generation: 3,
                parserVersion: 1,
                latestStreamSeq: 9,
                limit: 50,
                beforeTimelineSeq: null,
                nextBeforeTimelineSeq: null,
                hasMore: false
            }
        })

        expect(page.items[0]?.kind).toBe('reasoning')
        expect(page.page.latestStreamSeq).toBe(9)
    })
})
