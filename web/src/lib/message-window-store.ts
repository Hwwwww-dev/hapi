import type { ApiClient } from '@/api/client'
import { extractMessagesResetRequired } from '@/api/client'
import { canonicalRootsToRenderBlocks } from '@/chat/canonical'
import type { HappyRenderBlock } from '@/lib/assistant-runtime'
import type {
    CanonicalResetEvent,
    CanonicalRootBlock,
    CanonicalRootUpsertEvent,
    DecryptedMessage,
    MessageStatus,
    MessagesResponse,
} from '@/types/api'
import { applyCanonicalReset, applyCanonicalRootUpsert } from '@/lib/canonical-realtime'

export type MessageWindowState = {
    sessionId: string
    roots: CanonicalRootBlock[]
    items: CanonicalRootBlock[]
    renderBlocks: HappyRenderBlock[]
    pendingCount: number
    generation: number | null
    latestStreamSeq: number
    hasMore: boolean
    beforeTimelineSeq: number | null
    isLoading: boolean
    isLoadingMore: boolean
    warning: string | null
    atBottom: boolean
    needsRefresh: boolean
    messagesVersion: number
}

export const VISIBLE_WINDOW_SIZE = 400
const PAGE_SIZE = 50

const states = new Map<string, InternalState>()
const listeners = new Map<string, Set<() => void>>()

type InternalState = MessageWindowState & {
    canonicalItems: CanonicalRootBlock[]
    optimisticRoots: CanonicalRootBlock[]
    hiddenCanonicalCount: number
    windowStartIndex: number
    refreshGenerationHint: number | null
}

type WindowSelection = {
    items: CanonicalRootBlock[]
    windowStartIndex: number
    hiddenCanonicalCount: number
    hasMore: boolean
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getPayloadRecord(root: CanonicalRootBlock): Record<string, unknown> {
    return isObject(root.payload) ? root.payload : {}
}

function getRootLocalId(root: CanonicalRootBlock): string | null {
    const payload = getPayloadRecord(root)
    return typeof payload.localId === 'string' && payload.localId.length > 0
        ? payload.localId
        : null
}

function getRootStatus(root: CanonicalRootBlock): MessageStatus | undefined {
    const payload = getPayloadRecord(root)
    return payload.status === 'sending' || payload.status === 'sent' || payload.status === 'failed'
        ? payload.status
        : undefined
}

function getRootText(root: CanonicalRootBlock): string {
    const payload = getPayloadRecord(root)
    return typeof payload.text === 'string' ? payload.text : ''
}

function isUserTextRoot(root: CanonicalRootBlock): boolean {
    return root.kind === 'user-text'
}

function compareRoots(left: CanonicalRootBlock, right: CanonicalRootBlock): number {
    if (left.timelineSeq !== right.timelineSeq) {
        return left.timelineSeq - right.timelineSeq
    }
    if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt
    }
    return left.id.localeCompare(right.id)
}

function compareRenderableRoots(left: CanonicalRootBlock, right: CanonicalRootBlock): number {
    if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt
    }
    if (left.timelineSeq !== right.timelineSeq) {
        return left.timelineSeq - right.timelineSeq
    }
    return left.id.localeCompare(right.id)
}

function mergeCanonicalRoots(
    existing: readonly CanonicalRootBlock[],
    incoming: readonly CanonicalRootBlock[]
): CanonicalRootBlock[] {
    if (existing.length === 0) {
        return [...incoming].sort(compareRoots)
    }
    if (incoming.length === 0) {
        return [...existing].sort(compareRoots)
    }

    const byId = new Map<string, CanonicalRootBlock>()
    for (const root of existing) {
        byId.set(root.id, root)
    }
    for (const root of incoming) {
        byId.set(root.id, root)
    }

    return Array.from(byId.values()).sort(compareRoots)
}

function filterConfirmedOptimisticRoots(
    optimisticRoots: readonly CanonicalRootBlock[],
    canonicalRoots: readonly CanonicalRootBlock[]
): CanonicalRootBlock[] {
    if (optimisticRoots.length === 0 || canonicalRoots.length === 0) {
        return [...optimisticRoots]
    }

    const canonicalUserRoots = canonicalRoots.filter(isUserTextRoot)
    const canonicalLocalIds = new Set(
        canonicalUserRoots
            .map(getRootLocalId)
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )

    return optimisticRoots.filter((root) => {
        const localId = getRootLocalId(root)
        if (localId && canonicalLocalIds.has(localId)) {
            return false
        }

        if (getRootStatus(root) !== 'sent') {
            return true
        }

        const text = getRootText(root).trim()
        if (!text) {
            return true
        }

        return !canonicalUserRoots.some((candidate) => {
            return getRootText(candidate).trim() === text
                && Math.abs(candidate.createdAt - root.createdAt) < 10_000
        })
    })
}

function mergeVisibleRoots(
    canonicalItems: readonly CanonicalRootBlock[],
    optimisticRoots: readonly CanonicalRootBlock[]
): CanonicalRootBlock[] {
    if (optimisticRoots.length === 0) {
        return [...canonicalItems]
    }

    const merged = [...canonicalItems, ...optimisticRoots]
    const byId = new Map<string, CanonicalRootBlock>()
    for (const root of merged) {
        byId.set(root.id, root)
    }
    return Array.from(byId.values()).sort(compareRenderableRoots)
}

function getWindowMaxStart(roots: readonly CanonicalRootBlock[]): number {
    return Math.max(roots.length - VISIBLE_WINDOW_SIZE, 0)
}

function applyWindow(
    roots: readonly CanonicalRootBlock[],
    requestedStartIndex: number,
    visibleCount: number = VISIBLE_WINDOW_SIZE
): WindowSelection {
    const maxStart = getWindowMaxStart(roots)
    const windowStartIndex = Math.min(Math.max(requestedStartIndex, 0), maxStart)
    const size = Math.max(1, Math.min(visibleCount, VISIBLE_WINDOW_SIZE))
    const items = roots.slice(windowStartIndex, windowStartIndex + size)
    const hiddenCanonicalCount = Math.max(0, roots.length - (windowStartIndex + items.length))

    return {
        items,
        windowStartIndex,
        hiddenCanonicalCount,
        hasMore: windowStartIndex > 0,
    }
}

function selectBottomWindow(roots: readonly CanonicalRootBlock[]): WindowSelection {
    return applyWindow(roots, getWindowMaxStart(roots))
}

function selectPreservedWindow(prev: InternalState, roots: readonly CanonicalRootBlock[]): WindowSelection {
    const anchorId = prev.canonicalItems[0]?.id
    const visibleCount = prev.canonicalItems.length > 0 ? prev.canonicalItems.length : VISIBLE_WINDOW_SIZE
    if (!anchorId) {
        return selectBottomWindow(roots)
    }

    const anchorIndex = roots.findIndex((root) => root.id === anchorId)
    if (anchorIndex >= 0) {
        return applyWindow(roots, anchorIndex, visibleCount)
    }

    return applyWindow(roots, prev.windowStartIndex, visibleCount)
}

function createOptimisticUserRoot(message: DecryptedMessage, generation: number | null): CanonicalRootBlock {
    const content = isObject(message.content) ? message.content : null
    const body = content && isObject(content.content) ? content.content : null
    const text = typeof body?.text === 'string' ? body.text : message.originalText ?? ''
    const attachments = Array.isArray(body?.attachments) ? body.attachments : undefined

    return {
        id: message.id,
        sessionId: 'optimistic',
        timelineSeq: Number.MAX_SAFE_INTEGER,
        siblingSeq: 0,
        parentBlockId: null,
        rootBlockId: message.id,
        depth: 0,
        kind: 'user-text',
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
        state: 'completed',
        payload: {
            text,
            ...(attachments ? { attachments } : {}),
            ...(message.localId ? { localId: message.localId } : {}),
            ...(message.status ? { status: message.status } : {}),
            ...(message.originalText ? { originalText: message.originalText } : {}),
            clientSynthetic: true,
        },
        sourceRawEventIds: [`optimistic:${message.id}`],
        parserVersion: 1,
        generation: generation ?? 1,
        children: []
    }
}

function createState(sessionId: string): InternalState {
    return {
        sessionId,
        roots: [],
        items: [],
        canonicalItems: [],
        optimisticRoots: [],
        pendingCount: 0,
        generation: null,
        latestStreamSeq: 0,
        hasMore: false,
        beforeTimelineSeq: null,
        isLoading: false,
        isLoadingMore: false,
        warning: null,
        atBottom: true,
        needsRefresh: false,
        renderBlocks: [],
        messagesVersion: 0,
        hiddenCanonicalCount: 0,
        windowStartIndex: 0,
        refreshGenerationHint: null,
    }
}

function getState(sessionId: string): InternalState {
    const existing = states.get(sessionId)
    if (existing) {
        return existing
    }
    const created = createState(sessionId)
    states.set(sessionId, created)
    return created
}

function notify(sessionId: string): void {
    const subs = listeners.get(sessionId)
    if (!subs) return
    for (const listener of subs) {
        listener()
    }
}

function setState(sessionId: string, next: InternalState): void {
    states.set(sessionId, next)
    notify(sessionId)
}

function updateState(sessionId: string, updater: (prev: InternalState) => InternalState): void {
    const prev = getState(sessionId)
    const next = updater(prev)
    if (next !== prev) {
        setState(sessionId, next)
    }
}

function buildState(
    prev: InternalState,
    updates: {
        roots?: CanonicalRootBlock[]
        canonicalItems?: CanonicalRootBlock[]
        optimisticRoots?: CanonicalRootBlock[]
        hiddenCanonicalCount?: number
        windowStartIndex?: number
        generation?: number | null
        latestStreamSeq?: number
        beforeTimelineSeq?: number | null
        isLoading?: boolean
        isLoadingMore?: boolean
        warning?: string | null
        atBottom?: boolean
        needsRefresh?: boolean
        refreshGenerationHint?: number | null
    }
): InternalState {
    const roots = updates.roots ?? prev.roots
    const canonicalItems = updates.canonicalItems ?? prev.canonicalItems
    const optimisticRoots = filterConfirmedOptimisticRoots(
        updates.optimisticRoots ?? prev.optimisticRoots,
        roots
    )
    const items = mergeVisibleRoots(canonicalItems, optimisticRoots)
    const renderBlocks = canonicalRootsToRenderBlocks(items)
    const hiddenCanonicalCount = updates.hiddenCanonicalCount ?? prev.hiddenCanonicalCount
    const messagesVersion = items === prev.items ? prev.messagesVersion : prev.messagesVersion + 1

    return {
        ...prev,
        roots,
        items,
        renderBlocks,
        canonicalItems,
        optimisticRoots,
        pendingCount: hiddenCanonicalCount,
        generation: updates.generation !== undefined ? updates.generation : prev.generation,
        latestStreamSeq: updates.latestStreamSeq !== undefined ? updates.latestStreamSeq : prev.latestStreamSeq,
        hasMore: (updates.windowStartIndex ?? prev.windowStartIndex) > 0,
        beforeTimelineSeq: updates.beforeTimelineSeq !== undefined ? updates.beforeTimelineSeq : prev.beforeTimelineSeq,
        isLoading: updates.isLoading !== undefined ? updates.isLoading : prev.isLoading,
        isLoadingMore: updates.isLoadingMore !== undefined ? updates.isLoadingMore : prev.isLoadingMore,
        warning: updates.warning !== undefined ? updates.warning : prev.warning,
        atBottom: updates.atBottom !== undefined ? updates.atBottom : prev.atBottom,
        needsRefresh: updates.needsRefresh !== undefined ? updates.needsRefresh : prev.needsRefresh,
        messagesVersion,
        hiddenCanonicalCount,
        windowStartIndex: updates.windowStartIndex ?? prev.windowStartIndex,
        refreshGenerationHint: updates.refreshGenerationHint !== undefined
            ? updates.refreshGenerationHint
            : prev.refreshGenerationHint,
    }
}

function getPageGeneration(response: MessagesResponse, fallback: number | null = null): number {
    return response.page.generation ?? fallback ?? 1
}

function getPageLatestStreamSeq(response: MessagesResponse): number {
    return response.page.latestStreamSeq ?? 0
}

function getPageNextBeforeTimelineSeq(response: MessagesResponse): number | null {
    return response.page.nextBeforeTimelineSeq ?? null
}

async function loadHeadPage(
    api: ApiClient,
    sessionId: string,
    generationHint: number | null
): Promise<MessagesResponse> {
    let generation = generationHint
    while (true) {
        try {
            return await api.getMessages(sessionId, {
                generation,
                beforeTimelineSeq: null,
                limit: PAGE_SIZE,
            })
        } catch (error) {
            const reset = extractMessagesResetRequired(error)
            if (!reset) {
                throw error
            }
            generation = reset.generation
        }
    }
}

async function loadCanonicalSnapshot(
    api: ApiClient,
    sessionId: string,
    generationHint: number | null,
    head: MessagesResponse
): Promise<{
    roots: CanonicalRootBlock[]
    generation: number
    latestStreamSeq: number
}> {
    let generation = generationHint
    let headPage: MessagesResponse | null = head

    while (true) {
        try {
            let roots: CanonicalRootBlock[] = []
            let cursor: number | null = null
            let latestStreamSeq = 0
            let page: MessagesResponse | null = headPage

            while (true) {
                const response: MessagesResponse = page ?? await api.getMessages(sessionId, {
                    generation,
                    beforeTimelineSeq: cursor,
                    limit: PAGE_SIZE,
                })
                page = null

                if (roots.length === 0) {
                    generation = getPageGeneration(response, generation)
                    latestStreamSeq = getPageLatestStreamSeq(response)
                }

                roots = mergeCanonicalRoots(roots, response.items ?? [])
                cursor = getPageNextBeforeTimelineSeq(response)
                if (cursor === null) {
                    return {
                        roots,
                        generation: getPageGeneration(response, generation),
                        latestStreamSeq,
                    }
                }
            }
        } catch (error) {
            const reset = extractMessagesResetRequired(error)
            if (!reset) {
                throw error
            }
            generation = reset.generation
            headPage = await loadHeadPage(api, sessionId, generation)
        }
    }
}

export function getMessageWindowState(sessionId: string): MessageWindowState {
    return getState(sessionId)
}

export function subscribeMessageWindow(sessionId: string, listener: () => void): () => void {
    const subs = listeners.get(sessionId) ?? new Set()
    subs.add(listener)
    listeners.set(sessionId, subs)
    return () => {
        const current = listeners.get(sessionId)
        if (!current) return
        current.delete(listener)
        if (current.size === 0) {
            listeners.delete(sessionId)
            states.delete(sessionId)
        }
    }
}

export function clearMessageWindow(sessionId: string): void {
    if (!states.has(sessionId)) {
        return
    }
    setState(sessionId, createState(sessionId))
}

export function seedMessageWindowFromSession(fromSessionId: string, toSessionId: string): void {
    if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) {
        return
    }

    const source = getState(fromSessionId)
    const base = createState(toSessionId)
    const next = buildState(base, {
        roots: [...source.roots],
        canonicalItems: [...source.canonicalItems],
        optimisticRoots: [...source.optimisticRoots],
        hiddenCanonicalCount: source.hiddenCanonicalCount,
        windowStartIndex: source.windowStartIndex,
        generation: source.generation,
        latestStreamSeq: source.latestStreamSeq,
        beforeTimelineSeq: source.beforeTimelineSeq,
        warning: source.warning,
        atBottom: source.atBottom,
        needsRefresh: source.needsRefresh,
        refreshGenerationHint: source.refreshGenerationHint,
        isLoading: false,
        isLoadingMore: false,
    })
    setState(toSessionId, next)
}

export async function fetchLatestMessages(api: ApiClient, sessionId: string): Promise<void> {
    const initial = getState(sessionId)
    if (initial.isLoading) {
        return
    }

    updateState(sessionId, (prev) => buildState(prev, {
        isLoading: true,
        warning: null,
        needsRefresh: false,
    }))

    try {
        const generationHint = initial.refreshGenerationHint ?? initial.generation
        const head = await loadHeadPage(api, sessionId, generationHint)
        const headGeneration = getPageGeneration(head, generationHint)
        const headLatestStreamSeq = getPageLatestStreamSeq(head)
        const shouldReloadSnapshot = initial.generation === null
            || initial.roots.length === 0
            || initial.generation !== headGeneration
            || initial.latestStreamSeq !== headLatestStreamSeq
            || initial.needsRefresh

        if (!shouldReloadSnapshot) {
            updateState(sessionId, (prev) => buildState(prev, {
                generation: headGeneration,
                latestStreamSeq: headLatestStreamSeq,
                beforeTimelineSeq: getPageNextBeforeTimelineSeq(head),
                isLoading: false,
                warning: null,
                needsRefresh: false,
                refreshGenerationHint: null,
            }))
            return
        }

        const snapshot = await loadCanonicalSnapshot(api, sessionId, headGeneration, head)
        updateState(sessionId, (prev) => {
            const window = !prev.atBottom && prev.generation === snapshot.generation && prev.canonicalItems.length > 0 && !prev.needsRefresh
                ? selectPreservedWindow(prev, snapshot.roots)
                : selectBottomWindow(snapshot.roots)
            return buildState(prev, {
                roots: snapshot.roots,
                canonicalItems: window.items,
                hiddenCanonicalCount: window.hiddenCanonicalCount,
                windowStartIndex: window.windowStartIndex,
                generation: snapshot.generation,
                latestStreamSeq: snapshot.latestStreamSeq,
                beforeTimelineSeq: null,
                isLoading: false,
                warning: null,
                needsRefresh: false,
                refreshGenerationHint: null,
            })
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load messages'
        updateState(sessionId, (prev) => buildState(prev, {
            isLoading: false,
            warning: message,
        }))
    }
}

export async function fetchOlderMessages(_: ApiClient, sessionId: string): Promise<void> {
    const initial = getState(sessionId)
    if (initial.isLoadingMore || !initial.hasMore) {
        return
    }

    updateState(sessionId, (prev) => buildState(prev, { isLoadingMore: true }))

    try {
        updateState(sessionId, (prev) => {
            const visibleCount = prev.canonicalItems.length > 0 ? prev.canonicalItems.length : VISIBLE_WINDOW_SIZE
            const window = applyWindow(prev.roots, prev.windowStartIndex - PAGE_SIZE, visibleCount)
            return buildState(prev, {
                canonicalItems: window.items,
                hiddenCanonicalCount: window.hiddenCanonicalCount,
                windowStartIndex: window.windowStartIndex,
                isLoadingMore: false,
            })
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load messages'
        updateState(sessionId, (prev) => buildState(prev, {
            isLoadingMore: false,
            warning: message,
        }))
    }
}

export function ingestCanonicalRootUpsert(sessionId: string, event: CanonicalRootUpsertEvent): void {
    updateState(sessionId, (prev) => {
        const result = applyCanonicalRootUpsert({
            generation: prev.generation,
            latestStreamSeq: prev.latestStreamSeq,
            roots: prev.roots,
        }, event)

        if (result.needsRefresh) {
            return buildState(prev, {
                roots: [],
                canonicalItems: [],
                hiddenCanonicalCount: 0,
                windowStartIndex: 0,
                generation: result.generation,
                latestStreamSeq: result.latestStreamSeq,
                beforeTimelineSeq: null,
                needsRefresh: true,
                refreshGenerationHint: result.generation,
            })
        }
        if (!result.changed) {
            return prev
        }

        const window = prev.atBottom
            ? selectBottomWindow(result.roots)
            : selectPreservedWindow(prev, result.roots)
        return buildState(prev, {
            roots: result.roots,
            canonicalItems: window.items,
            hiddenCanonicalCount: window.hiddenCanonicalCount,
            windowStartIndex: window.windowStartIndex,
            generation: result.generation,
            latestStreamSeq: result.latestStreamSeq,
            beforeTimelineSeq: null,
            needsRefresh: false,
            refreshGenerationHint: null,
        })
    })
}

export function ingestCanonicalReset(sessionId: string, event: CanonicalResetEvent): void {
    updateState(sessionId, (prev) => {
        const result = applyCanonicalReset({
            generation: prev.generation,
            latestStreamSeq: prev.latestStreamSeq,
            roots: prev.roots,
        }, event)

        if (!result.needsRefresh) {
            return prev
        }

        return buildState(prev, {
            roots: [],
            canonicalItems: [],
            hiddenCanonicalCount: 0,
            windowStartIndex: 0,
            generation: result.generation,
            latestStreamSeq: result.latestStreamSeq,
            beforeTimelineSeq: null,
            needsRefresh: true,
            refreshGenerationHint: result.generation,
        })
    })
}

export function flushPendingMessages(sessionId: string): boolean {
    const current = getState(sessionId)
    if (current.hiddenCanonicalCount === 0) {
        return false
    }

    updateState(sessionId, (prev) => {
        const window = selectBottomWindow(prev.roots)
        return buildState(prev, {
            canonicalItems: window.items,
            hiddenCanonicalCount: window.hiddenCanonicalCount,
            windowStartIndex: window.windowStartIndex,
            atBottom: true,
        })
    })

    return false
}

export function setAtBottom(sessionId: string, atBottom: boolean): void {
    updateState(sessionId, (prev) => {
        if (prev.atBottom === atBottom) {
            return prev
        }
        return buildState(prev, { atBottom })
    })
}

export function appendOptimisticMessage(sessionId: string, message: DecryptedMessage): void {
    updateState(sessionId, (prev) => buildState(prev, {
        optimisticRoots: mergeCanonicalRoots(prev.optimisticRoots, [createOptimisticUserRoot(message, prev.generation)]),
        atBottom: true,
    }))
}

export function updateMessageStatus(sessionId: string, localId: string, status: MessageStatus): void {
    if (!localId) {
        return
    }

    updateState(sessionId, (prev) => {
        let changed = false
        const optimisticRoots = prev.optimisticRoots.map((root) => {
            if (getRootLocalId(root) !== localId) {
                return root
            }
            const payload = getPayloadRecord(root)
            if (payload.status === status) {
                return root
            }
            changed = true
            return {
                ...root,
                payload: {
                    ...payload,
                    status
                }
            }
        })

        if (!changed) {
            return prev
        }

        return buildState(prev, { optimisticRoots })
    })
}
