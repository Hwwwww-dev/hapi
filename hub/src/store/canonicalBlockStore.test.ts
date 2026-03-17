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
    it('pages latest roots first by generation and keeps inline children attached', () => {
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

        expect(firstPage.items.map((root) => root.id)).toEqual(['root-b'])
        expect(firstPage.page.generation).toBe(3)
        expect(firstPage.page.nextBeforeTimelineSeq).toBe(2)
        expect(firstPage.page.hasMore).toBe(true)

        const secondPage = store.canonicalBlocks.getRootsPage(session.id, {
            generation: 3,
            beforeTimelineSeq: firstPage.page.nextBeforeTimelineSeq,
            limit: 1
        })

        expect(secondPage.items.map((root) => root.id)).toEqual(['root-a'])
        expect(secondPage.items[0]?.children.map((child) => child.id)).toEqual(['child-a-1'])
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

    it('getRootsPage with beforeTimelineSeq only queries needed rows', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'canonical-session-page-cursor',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        // 插入 200 条 root blocks
        const roots = Array.from({ length: 200 }, (_, i) =>
            createCanonicalRoot({
                id: `root-${i + 1}`,
                sessionId: session.id,
                generation: 1,
                timelineSeq: i + 1,
                state: 'complete'
            })
        )
        store.canonicalBlocks.replaceGeneration(session.id, 1, roots)

        // 请求第 2 页（beforeTimelineSeq=51, limit=50）
        const page = store.canonicalBlocks.getRootsPage(session.id, {
            generation: 1,
            beforeTimelineSeq: 51,
            limit: 50
        })

        expect(page.items).toHaveLength(50)
        expect(page.items[0]!.timelineSeq).toBe(1)
        expect(page.items[49]!.timelineSeq).toBe(50)
        expect(page.page.hasMore).toBe(false)
        expect(page.page.nextBeforeTimelineSeq).toBeNull()
    })

    it('getRootsPage with beforeTimelineSeq=null returns latest page', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'canonical-session-latest-page',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        const roots200 = Array.from({ length: 200 }, (_, i) =>
            createCanonicalRoot({
                id: `root-lp-${i + 1}`,
                sessionId: session.id,
                generation: 1,
                timelineSeq: i + 1,
                state: 'complete'
            })
        )
        store.canonicalBlocks.replaceGeneration(session.id, 1, roots200)

        const page = store.canonicalBlocks.getRootsPage(session.id, {
            generation: 1,
            beforeTimelineSeq: null,
            limit: 50
        })

        // beforeTimelineSeq=null 应返回最新的 50 条（timelineSeq 151-200）
        expect(page.items).toHaveLength(50)
        expect(page.items[0]!.timelineSeq).toBe(151)
        expect(page.items[49]!.timelineSeq).toBe(200)
        expect(page.page.hasMore).toBe(true)
        expect(page.page.nextBeforeTimelineSeq).toBe(151) // 向前翻页的游标
    })
})
