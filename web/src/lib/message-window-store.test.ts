import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanonicalRootBlock } from '@hapi/protocol/types'
import type { ApiClient } from '@/api/client'
import { ApiError } from '@/api/client'
import type { MessagesResponse } from '@/types/api'
import {
    appendOptimisticMessage,
    clearMessageWindow,
    fetchLatestMessages,
    fetchOlderMessages,
    flushPendingMessages,
    getMessageWindowState,
    ingestCanonicalRootUpsert,
    setAtBottom,
} from './message-window-store'

const SESSION_ID = 'session-canonical-history'

function createRoot(
    timelineSeq: number,
    overrides: Partial<CanonicalRootBlock> = {}
): CanonicalRootBlock {
    const id = overrides.id ?? `root-${timelineSeq}`
    const generation = overrides.generation ?? 1
    const children = overrides.children ?? []

    return {
        id,
        sessionId: overrides.sessionId ?? SESSION_ID,
        timelineSeq,
        siblingSeq: overrides.siblingSeq ?? 0,
        parentBlockId: null,
        rootBlockId: id,
        depth: 0,
        kind: overrides.kind ?? 'agent-text',
        createdAt: overrides.createdAt ?? timelineSeq * 1_000,
        updatedAt: overrides.updatedAt ?? timelineSeq * 1_000,
        state: overrides.state ?? 'completed',
        payload: overrides.payload ?? { text: `message ${timelineSeq}` },
        sourceRawEventIds: overrides.sourceRawEventIds ?? [`raw-${timelineSeq}`],
        parserVersion: overrides.parserVersion ?? 1,
        generation,
        children,
    }
}

function createPage(
    items: CanonicalRootBlock[],
    options: {
        generation?: number
        latestStreamSeq?: number
        beforeTimelineSeq?: number | null
        nextBeforeTimelineSeq?: number | null
        hasMore?: boolean
    } = {}
): MessagesResponse {
    return {
        items,
        page: {
            generation: options.generation ?? items[0]?.generation ?? 1,
            parserVersion: 1,
            latestStreamSeq: options.latestStreamSeq ?? 0,
            limit: 50,
            beforeTimelineSeq: options.beforeTimelineSeq ?? null,
            nextBeforeTimelineSeq: options.nextBeforeTimelineSeq ?? null,
            hasMore: options.hasMore ?? false,
        }
    }
}

function createApiClient(getMessages: ApiClient['getMessages']): ApiClient {
    return { getMessages } as ApiClient
}

describe('message-window-store canonical history', () => {
    beforeEach(() => {
        clearMessageWindow(SESSION_ID)
    })

    it('bootstraps only the latest canonical page instead of crawling the full snapshot', async () => {
        const getMessages = vi.fn<ApiClient['getMessages']>()
            .mockResolvedValueOnce(createPage([
                createRoot(3),
                createRoot(4),
            ], {
                generation: 1,
                latestStreamSeq: 9,
                beforeTimelineSeq: null,
                nextBeforeTimelineSeq: 3,
                hasMore: true,
            }))

        await fetchLatestMessages(createApiClient(getMessages), SESSION_ID)

        const state = getMessageWindowState(SESSION_ID)
        expect(getMessages).toHaveBeenCalledTimes(1)
        expect(state.generation).toBe(1)
        expect(state.latestStreamSeq).toBe(9)
        expect(state.roots.map((root) => root.id)).toEqual(['root-3', 'root-4'])
        expect(state.items.map((root) => root.id)).toEqual(['root-3', 'root-4'])
        expect(state.renderBlocks.map((block) => block.id)).toEqual(['root-3', 'root-4'])
        expect(state.hasMore).toBe(true)
        expect(state.beforeTimelineSeq).toBe(3)
    })

    it('requests older canonical pages from the API instead of relying on a full in-memory snapshot', async () => {
        const getMessages = vi.fn<ApiClient['getMessages']>()
            .mockResolvedValueOnce(createPage([
                createRoot(3),
                createRoot(4),
            ], {
                generation: 1,
                latestStreamSeq: 12,
                beforeTimelineSeq: null,
                nextBeforeTimelineSeq: 3,
                hasMore: true,
            }))
            .mockResolvedValueOnce(createPage([
                createRoot(1),
                createRoot(2),
            ], {
                generation: 1,
                latestStreamSeq: 12,
                beforeTimelineSeq: 3,
                nextBeforeTimelineSeq: null,
                hasMore: false,
            }))

        const api = createApiClient(getMessages)
        await fetchLatestMessages(api, SESSION_ID)

        let state = getMessageWindowState(SESSION_ID)
        expect(state.items.map((root) => root.timelineSeq)).toEqual([3, 4])
        expect(state.hasMore).toBe(true)

        await fetchOlderMessages(api, SESSION_ID)

        state = getMessageWindowState(SESSION_ID)
        expect(getMessages).toHaveBeenCalledTimes(2)
        expect(state.items.map((root) => root.timelineSeq)).toEqual([1, 2, 3, 4])
        expect(state.hasMore).toBe(false)
        expect(state.beforeTimelineSeq).toBeNull()
    })

    it('exposes optimistic overlay entries as render blocks without rematerializing canonical history', async () => {
        const getMessages = vi.fn<ApiClient['getMessages']>()
            .mockResolvedValueOnce(createPage([
                createRoot(1, {
                    kind: 'agent-text',
                    payload: { text: 'server reply' }
                })
            ], {
                generation: 1,
                latestStreamSeq: 10,
            }))

        await fetchLatestMessages(createApiClient(getMessages), SESSION_ID)

        appendOptimisticMessage(SESSION_ID, {
            id: 'local-user-1',
            localId: 'local-user-1',
            seq: null,
            createdAt: 2_000,
            status: 'sending',
            originalText: 'optimistic hello',
            content: {
                role: 'user',
                content: {
                    type: 'text',
                    text: 'optimistic hello'
                }
            }
        })

        const state = getMessageWindowState(SESSION_ID)
        expect(state.renderBlocks.map((block) => block.id)).toEqual(['root-1', 'local-user-1'])
        expect(state.renderBlocks.at(-1)).toMatchObject({
            id: 'local-user-1',
            kind: 'user-text',
            text: 'optimistic hello'
        })
    })

    it('ignores stale canonical realtime ops and keeps newer roots pending while away from bottom', async () => {
        const getMessages = vi.fn<ApiClient['getMessages']>()
            .mockResolvedValueOnce(createPage([
                createRoot(1),
                createRoot(2),
                createRoot(3),
            ], {
                generation: 1,
                latestStreamSeq: 10,
            }))

        await fetchLatestMessages(createApiClient(getMessages), SESSION_ID)
        setAtBottom(SESSION_ID, false)

        ingestCanonicalRootUpsert(SESSION_ID, {
            type: 'canonical-root-upsert',
            sessionId: SESSION_ID,
            generation: 1,
            parserVersion: 1,
            streamSeq: 9,
            op: 'append',
            root: createRoot(4),
        })

        let state = getMessageWindowState(SESSION_ID)
        expect(state.roots.map((root) => root.id)).toEqual(['root-1', 'root-2', 'root-3'])
        expect(state.pendingCount).toBe(0)

        ingestCanonicalRootUpsert(SESSION_ID, {
            type: 'canonical-root-upsert',
            sessionId: SESSION_ID,
            generation: 1,
            parserVersion: 1,
            streamSeq: 11,
            op: 'append',
            root: createRoot(4),
        })

        state = getMessageWindowState(SESSION_ID)
        expect(state.roots.map((root) => root.id)).toEqual(['root-1', 'root-2', 'root-3', 'root-4'])
        expect(state.items.map((root) => root.id)).toEqual(['root-1', 'root-2', 'root-3'])
        expect(state.renderBlocks.map((block) => block.id)).toEqual(['root-1', 'root-2', 'root-3'])
        expect(state.pendingCount).toBe(1)

        const needsRefresh = flushPendingMessages(SESSION_ID)
        state = getMessageWindowState(SESSION_ID)
        expect(needsRefresh).toBe(false)
        expect(state.items.map((root) => root.id)).toEqual(['root-1', 'root-2', 'root-3', 'root-4'])
        expect(state.renderBlocks.map((block) => block.id)).toEqual(['root-1', 'root-2', 'root-3', 'root-4'])
        expect(state.pendingCount).toBe(0)
    })

    it('retries history bootstrap with the advertised generation after reset-required', async () => {
        const firstApi = createApiClient(vi.fn<ApiClient['getMessages']>()
            .mockResolvedValueOnce(createPage([
                createRoot(1, { generation: 1 }),
            ], {
                generation: 1,
                latestStreamSeq: 3,
            })))

        await fetchLatestMessages(firstApi, SESSION_ID)

        const staleGenerationError = new ApiError(
            'HTTP 409 Conflict: {"reset":true,"generation":2,"parserVersion":1}',
            409,
            undefined,
            '{"reset":true,"generation":2,"parserVersion":1}'
        )
        const nextRoot = createRoot(1, {
            id: 'root-next-generation',
            generation: 2,
            rootBlockId: 'root-next-generation',
            payload: { text: 'after reset' },
        })

        const getMessages = vi.fn<ApiClient['getMessages']>()
            .mockRejectedValueOnce(staleGenerationError)
            .mockResolvedValueOnce(createPage([nextRoot], {
                generation: 2,
                latestStreamSeq: 7,
            }))

        await fetchLatestMessages(createApiClient(getMessages), SESSION_ID)

        const state = getMessageWindowState(SESSION_ID)
        expect(state.generation).toBe(2)
        expect(state.latestStreamSeq).toBe(7)
        expect(state.roots.map((root) => root.id)).toEqual(['root-next-generation'])
        expect(getMessages).toHaveBeenNthCalledWith(2, SESSION_ID, expect.objectContaining({ generation: 2 }))
    })
})
