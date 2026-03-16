import { describe, expect, it } from 'bun:test'

import type { CanonicalChildBlock, CanonicalRootBlock } from '@hapi/protocol'

import { Store } from './index'

function createCanonicalChild(overrides: Partial<CanonicalChildBlock> = {}): CanonicalChildBlock {
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
        payload: { text: 'child' },
        sourceRawEventIds: ['raw-2'],
        parserVersion: 1,
        generation: 3,
        children: [],
        ...overrides
    }
}

function createCanonicalRoot(overrides: Partial<CanonicalRootBlock> = {}): CanonicalRootBlock {
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
        payload: { text: 'root' },
        sourceRawEventIds: ['raw-1'],
        parserVersion: 1,
        generation: 3,
        children: [],
        ...overrides
    }
}

describe('CanonicalBlockStore', () => {
    it('pages roots by generation and keeps inline children attached', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'canonical-session-1',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        const legacyRoot = createCanonicalRoot({
            id: 'legacy-root',
            sessionId: session.id,
            generation: 2,
            timelineSeq: 1,
            state: 'complete'
        })
        const rootA = createCanonicalRoot({
            id: 'root-a',
            sessionId: session.id,
            generation: 3,
            timelineSeq: 1,
            state: 'complete',
            children: [
                createCanonicalChild({
                    id: 'child-a-1',
                    sessionId: session.id,
                    generation: 3,
                    timelineSeq: 1,
                    parentBlockId: 'root-a',
                    rootBlockId: 'root-a'
                })
            ]
        })
        const rootB = createCanonicalRoot({
            id: 'root-b',
            sessionId: session.id,
            generation: 3,
            timelineSeq: 2,
            state: 'complete',
            payload: { text: 'second root' },
            sourceRawEventIds: ['raw-3']
        })

        store.canonicalBlocks.replaceGeneration(session.id, 2, [legacyRoot])
        store.canonicalBlocks.replaceGeneration(session.id, 3, [rootA, rootB])

        const firstPage = store.canonicalBlocks.getRootsPage(session.id, {
            generation: 3,
            beforeTimelineSeq: null,
            limit: 1
        })

        expect(firstPage.items.map((root) => root.id)).toEqual(['root-a'])
        expect(firstPage.items[0]?.children.map((child) => child.id)).toEqual(['child-a-1'])
        expect(firstPage.page.generation).toBe(3)
        expect(firstPage.page.nextBeforeTimelineSeq).toBe(2)
        expect(firstPage.page.hasMore).toBe(true)

        const secondPage = store.canonicalBlocks.getRootsPage(session.id, {
            generation: 3,
            beforeTimelineSeq: firstPage.page.nextBeforeTimelineSeq,
            limit: 1
        })

        expect(secondPage.items.map((root) => root.id)).toEqual(['root-b'])
        expect(secondPage.page.nextBeforeTimelineSeq).toBeNull()
        expect(secondPage.page.hasMore).toBe(false)

        const legacyPage = store.canonicalBlocks.getRootsPage(session.id, {
            generation: 2,
            beforeTimelineSeq: null,
            limit: 10
        })

        expect(legacyPage.items.map((root) => root.id)).toEqual(['legacy-root'])
    })

    it('replaces all rows for a generation instead of appending stale roots', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'canonical-session-2',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        const rootA = createCanonicalRoot({
            id: 'root-a',
            sessionId: session.id,
            generation: 4,
            timelineSeq: 1,
            state: 'complete'
        })
        const rootB = createCanonicalRoot({
            id: 'root-b',
            sessionId: session.id,
            generation: 4,
            timelineSeq: 2,
            state: 'complete',
            sourceRawEventIds: ['raw-2']
        })

        store.canonicalBlocks.replaceGeneration(session.id, 4, [rootA, rootB])
        store.canonicalBlocks.replaceGeneration(session.id, 4, [rootB])

        const page = store.canonicalBlocks.getRootsPage(session.id, {
            generation: 4,
            beforeTimelineSeq: null,
            limit: 10
        })

        expect(page.items.map((root) => root.id)).toEqual(['root-b'])
        expect(page.page.hasMore).toBe(false)
    })
})
