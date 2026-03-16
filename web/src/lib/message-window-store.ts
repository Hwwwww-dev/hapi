import { safeStringify } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { extractMessagesResetRequired } from '@/api/client'
import { canonicalRootsToRenderBlocks, type CanonicalRenderBlock } from '@/chat/canonical'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import type {
    CanonicalResetEvent,
    CanonicalRootBlock,
    CanonicalRootUpsertEvent,
    DecryptedMessage,
    MessageStatus,
    MessagesResponse,
} from '@/types/api'
import { applyCanonicalReset, applyCanonicalRootUpsert } from '@/lib/canonical-realtime'
import { isUserMessage, mergeMessages } from '@/lib/messages'

export type MessageWindowState = {
    sessionId: string
    roots: CanonicalRootBlock[]
    items: CanonicalRootBlock[]
    messages: DecryptedMessage[]
    pending: DecryptedMessage[]
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
export const PENDING_WINDOW_SIZE = 200
const PAGE_SIZE = 50
const PENDING_OVERFLOW_WARNING = 'New messages arrived while you were away. Scroll to bottom to refresh.'

type InternalState = MessageWindowState & {
    overlayMessages: DecryptedMessage[]
    pendingOverflowCount: number
    pendingVisibleCount: number
    pendingOverflowVisibleCount: number
    hiddenCanonicalCount: number
    windowStartIndex: number
    refreshGenerationHint: number | null
}

type PendingVisibilityCacheEntry = {
    source: DecryptedMessage
    visible: boolean
}

type WindowSelection = {
    items: CanonicalRootBlock[]
    windowStartIndex: number
    hiddenCanonicalCount: number
    hasMore: boolean
}

const states = new Map<string, InternalState>()
const listeners = new Map<string, Set<() => void>>()
const pendingVisibilityCacheBySession = new Map<string, Map<string, PendingVisibilityCacheEntry>>()

function getPendingVisibilityCache(sessionId: string): Map<string, PendingVisibilityCacheEntry> {
    const existing = pendingVisibilityCacheBySession.get(sessionId)
    if (existing) {
        return existing
    }
    const created = new Map<string, PendingVisibilityCacheEntry>()
    pendingVisibilityCacheBySession.set(sessionId, created)
    return created
}

function clearPendingVisibilityCache(sessionId: string): void {
    pendingVisibilityCacheBySession.delete(sessionId)
}

function isVisiblePendingMessage(sessionId: string, message: DecryptedMessage): boolean {
    const cache = getPendingVisibilityCache(sessionId)
    const cached = cache.get(message.id)
    if (cached && cached.source === message) {
        return cached.visible
    }
    const visible = normalizeDecryptedMessage(message) !== null
    cache.set(message.id, { source: message, visible })
    return visible
}

function countVisiblePendingMessages(sessionId: string, messages: DecryptedMessage[]): number {
    let count = 0
    for (const message of messages) {
        if (isVisiblePendingMessage(sessionId, message)) {
            count += 1
        }
    }
    return count
}

function syncPendingVisibilityCache(sessionId: string, pending: DecryptedMessage[]): void {
    const cache = pendingVisibilityCacheBySession.get(sessionId)
    if (!cache) {
        return
    }
    const keep = new Set(pending.map((message) => message.id))
    for (const id of cache.keys()) {
        if (!keep.has(id)) {
            cache.delete(id)
        }
    }
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
    const anchorId = prev.items[0]?.id
    const visibleCount = prev.items.length > 0 ? prev.items.length : VISIBLE_WINDOW_SIZE
    if (!anchorId) {
        return selectBottomWindow(roots)
    }

    const anchorIndex = roots.findIndex((root) => root.id === anchorId)
    if (anchorIndex >= 0) {
        return applyWindow(roots, anchorIndex, visibleCount)
    }

    return applyWindow(roots, prev.windowStartIndex, visibleCount)
}

function formatCanonicalLabel(block: CanonicalRenderBlock): string {
    switch (block.kind) {
        case 'event':
            return block.text
        case 'subagent-root':
            return block.title ?? block.description ?? 'Subagent'
        case 'fallback-raw':
            return block.summary ?? safeStringify(block.preview)
        case 'tool-call':
        case 'tool-result':
            return `${block.tool.name}: ${safeStringify(block.tool.result ?? block.tool.input ?? block.payload)}`
        default:
            return block.text
    }
}

function appendLegacyAssistantBlocks(
    block: CanonicalRenderBlock,
    target: Array<Record<string, unknown>>
): void {
    switch (block.kind) {
        case 'user-text':
        case 'agent-text':
            target.push({ type: 'text', text: block.text })
            break
        case 'reasoning':
            target.push({ type: 'thinking', thinking: block.text })
            break
        case 'event':
            target.push({ type: 'text', text: block.text })
            break
        case 'tool-call':
            target.push({
                type: 'tool_use',
                id: block.tool.id,
                name: block.tool.name,
                input: block.tool.input,
            })
            break
        case 'tool-result':
            target.push({
                type: 'tool_result',
                tool_use_id: block.tool.id,
                content: block.tool.result,
                is_error: block.tool.state === 'error',
            })
            break
        case 'subagent-root':
        case 'fallback-raw':
            target.push({ type: 'text', text: formatCanonicalLabel(block) })
            break
    }

    for (const child of block.children) {
        appendLegacyAssistantBlocks(child, target)
    }
}

function toLegacyEvent(block: Extract<CanonicalRenderBlock, { kind: 'event' }>): Record<string, unknown> {
    const subtype = block.subtype?.trim().toLowerCase() ?? ''
    if (subtype === 'title-changed') {
        const title = typeof block.payload.title === 'string' ? block.payload.title : undefined
        return { type: 'title-changed', title }
    }
    if (subtype === 'turn-duration') {
        const durationMs = typeof block.payload.durationMs === 'number'
            ? block.payload.durationMs
            : typeof block.payload.duration_ms === 'number'
                ? block.payload.duration_ms
                : 0
        return { type: 'turn-duration', durationMs }
    }
    if (subtype === 'compact') {
        return { type: 'compact', trigger: 'canonical', preTokens: 0 }
    }
    if (subtype === 'microcompact') {
        return { type: 'microcompact', trigger: 'canonical', preTokens: 0, tokensSaved: 0 }
    }
    return { type: 'message', message: block.text }
}

function renderBlockToLegacyMessage(block: CanonicalRenderBlock): DecryptedMessage {
    if (block.kind === 'user-text') {
        return {
            id: block.id,
            seq: null,
            localId: null,
            content: {
                role: 'user',
                content: {
                    type: 'text',
                    text: block.text,
                    attachments: block.attachments,
                }
            },
            createdAt: block.createdAt,
        }
    }

    if (block.kind === 'event') {
        return {
            id: block.id,
            seq: null,
            localId: null,
            content: {
                type: 'event',
                data: toLegacyEvent(block),
            },
            createdAt: block.createdAt,
        }
    }

    const content: Array<Record<string, unknown>> = []
    appendLegacyAssistantBlocks(block, content)

    if (content.length === 0) {
        content.push({ type: 'text', text: formatCanonicalLabel(block) })
    }

    return {
        id: block.id,
        seq: null,
        localId: null,
        content: {
            role: 'assistant',
            content,
        },
        createdAt: block.createdAt,
    }
}

function materializeCanonicalMessages(items: readonly CanonicalRootBlock[]): DecryptedMessage[] {
    return canonicalRootsToRenderBlocks(items).map(renderBlockToLegacyMessage)
}

function createState(sessionId: string): InternalState {
    return {
        sessionId,
        roots: [],
        items: [],
        messages: [],
        overlayMessages: [],
        pending: [],
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
        messagesVersion: 0,
        pendingOverflowCount: 0,
        pendingVisibleCount: 0,
        pendingOverflowVisibleCount: 0,
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

function trimVisibleMessages(messages: DecryptedMessage[], mode: 'append' | 'prepend'): DecryptedMessage[] {
    if (messages.length <= VISIBLE_WINDOW_SIZE) {
        return messages
    }
    if (mode === 'prepend') {
        return messages.slice(0, VISIBLE_WINDOW_SIZE)
    }
    return messages.slice(messages.length - VISIBLE_WINDOW_SIZE)
}

function trimPending(
    sessionId: string,
    messages: DecryptedMessage[]
): { pending: DecryptedMessage[]; dropped: number; droppedVisible: number } {
    if (messages.length <= PENDING_WINDOW_SIZE) {
        return { pending: messages, dropped: 0, droppedVisible: 0 }
    }
    const cutoff = messages.length - PENDING_WINDOW_SIZE
    const droppedMessages = messages.slice(0, cutoff)
    const pending = messages.slice(cutoff)
    const droppedVisible = countVisiblePendingMessages(sessionId, droppedMessages)
    return { pending, dropped: droppedMessages.length, droppedVisible }
}

function filterPendingAgainstVisible(pending: DecryptedMessage[], visible: DecryptedMessage[]): DecryptedMessage[] {
    if (pending.length === 0 || visible.length === 0) {
        return pending
    }
    const visibleIds = new Set(visible.map((message) => message.id))
    return pending.filter((message) => !visibleIds.has(message.id))
}

function isOptimisticMessage(message: DecryptedMessage): boolean {
    return Boolean(message.localId && message.id === message.localId)
}

function buildState(
    prev: InternalState,
    updates: {
        roots?: CanonicalRootBlock[]
        items?: CanonicalRootBlock[]
        overlayMessages?: DecryptedMessage[]
        pending?: DecryptedMessage[]
        pendingOverflowCount?: number
        pendingVisibleCount?: number
        pendingOverflowVisibleCount?: number
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
    const items = updates.items ?? prev.items
    const overlayMessages = updates.overlayMessages ?? prev.overlayMessages
    const pending = updates.pending ?? prev.pending
    const pendingChanged = pending !== prev.pending
    let pendingVisibleCount = updates.pendingVisibleCount ?? prev.pendingVisibleCount
    if (pendingChanged && updates.pendingVisibleCount === undefined) {
        pendingVisibleCount = countVisiblePendingMessages(prev.sessionId, pending)
    }
    if (pendingChanged) {
        syncPendingVisibilityCache(prev.sessionId, pending)
    }

    const pendingOverflowCount = updates.pendingOverflowCount ?? prev.pendingOverflowCount
    const pendingOverflowVisibleCount = updates.pendingOverflowVisibleCount ?? prev.pendingOverflowVisibleCount
    const windowStartIndex = updates.windowStartIndex ?? prev.windowStartIndex
    const hiddenCanonicalCount = updates.hiddenCanonicalCount ?? prev.hiddenCanonicalCount

    let messages = prev.messages
    if (items !== prev.items || overlayMessages !== prev.overlayMessages) {
        messages = mergeMessages(materializeCanonicalMessages(items), overlayMessages)
    }
    const pendingCount = pendingVisibleCount + pendingOverflowVisibleCount + hiddenCanonicalCount
    const messagesVersion = messages === prev.messages ? prev.messagesVersion : prev.messagesVersion + 1

    return {
        ...prev,
        roots,
        items,
        messages,
        overlayMessages,
        pending,
        pendingOverflowCount,
        pendingVisibleCount,
        pendingOverflowVisibleCount,
        hiddenCanonicalCount,
        windowStartIndex,
        pendingCount,
        generation: updates.generation !== undefined ? updates.generation : prev.generation,
        latestStreamSeq: updates.latestStreamSeq !== undefined ? updates.latestStreamSeq : prev.latestStreamSeq,
        hasMore: windowStartIndex > 0,
        beforeTimelineSeq: updates.beforeTimelineSeq !== undefined ? updates.beforeTimelineSeq : prev.beforeTimelineSeq,
        isLoading: updates.isLoading !== undefined ? updates.isLoading : prev.isLoading,
        isLoadingMore: updates.isLoadingMore !== undefined ? updates.isLoadingMore : prev.isLoadingMore,
        warning: updates.warning !== undefined ? updates.warning : prev.warning,
        atBottom: updates.atBottom !== undefined ? updates.atBottom : prev.atBottom,
        needsRefresh: updates.needsRefresh !== undefined ? updates.needsRefresh : prev.needsRefresh,
        messagesVersion,
        refreshGenerationHint: updates.refreshGenerationHint !== undefined
            ? updates.refreshGenerationHint
            : prev.refreshGenerationHint,
    }
}

function mergeIntoPending(
    prev: InternalState,
    incoming: DecryptedMessage[]
): {
    pending: DecryptedMessage[]
    pendingVisibleCount: number
    pendingOverflowCount: number
    pendingOverflowVisibleCount: number
    warning: string | null
} {
    if (incoming.length === 0) {
        return {
            pending: prev.pending,
            pendingVisibleCount: prev.pendingVisibleCount,
            pendingOverflowCount: prev.pendingOverflowCount,
            pendingOverflowVisibleCount: prev.pendingOverflowVisibleCount,
            warning: prev.warning,
        }
    }

    const mergedPending = mergeMessages(prev.pending, incoming)
    const filtered = filterPendingAgainstVisible(mergedPending, prev.messages)
    const { pending, dropped, droppedVisible } = trimPending(prev.sessionId, filtered)
    const pendingVisibleCount = countVisiblePendingMessages(prev.sessionId, pending)
    const pendingOverflowCount = prev.pendingOverflowCount + dropped
    const pendingOverflowVisibleCount = prev.pendingOverflowVisibleCount + droppedVisible
    const warning = droppedVisible > 0 && !prev.warning ? PENDING_OVERFLOW_WARNING : prev.warning

    return {
        pending,
        pendingVisibleCount,
        pendingOverflowCount,
        pendingOverflowVisibleCount,
        warning,
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
            clearPendingVisibilityCache(sessionId)
        }
    }
}

export function clearMessageWindow(sessionId: string): void {
    clearPendingVisibilityCache(sessionId)
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
        items: [...source.items],
        overlayMessages: [...source.overlayMessages],
        pending: [...source.pending],
        pendingOverflowCount: source.pendingOverflowCount,
        pendingOverflowVisibleCount: source.pendingOverflowVisibleCount,
        pendingVisibleCount: source.pendingVisibleCount,
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
            const window = !prev.atBottom && prev.generation === snapshot.generation && prev.items.length > 0 && !prev.needsRefresh
                ? selectPreservedWindow(prev, snapshot.roots)
                : selectBottomWindow(snapshot.roots)
            const visibleMessages = mergeMessages(
                materializeCanonicalMessages(window.items),
                prev.overlayMessages
            )
            const pending = filterPendingAgainstVisible(prev.pending, visibleMessages)
            return buildState(prev, {
                roots: snapshot.roots,
                items: window.items,
                hiddenCanonicalCount: window.hiddenCanonicalCount,
                windowStartIndex: window.windowStartIndex,
                pending,
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
            const visibleCount = prev.items.length > 0 ? prev.items.length : VISIBLE_WINDOW_SIZE
            const window = applyWindow(prev.roots, prev.windowStartIndex - PAGE_SIZE, visibleCount)
            const visibleMessages = mergeMessages(
                materializeCanonicalMessages(window.items),
                prev.overlayMessages
            )
            const pending = filterPendingAgainstVisible(prev.pending, visibleMessages)
            return buildState(prev, {
                items: window.items,
                hiddenCanonicalCount: window.hiddenCanonicalCount,
                windowStartIndex: window.windowStartIndex,
                pending,
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
                items: [],
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
        const visibleMessages = mergeMessages(
            materializeCanonicalMessages(window.items),
            prev.overlayMessages
        )
        const pending = filterPendingAgainstVisible(prev.pending, visibleMessages)
        return buildState(prev, {
            roots: result.roots,
            items: window.items,
            hiddenCanonicalCount: window.hiddenCanonicalCount,
            windowStartIndex: window.windowStartIndex,
            pending,
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
            items: [],
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

export function ingestIncomingMessages(sessionId: string, incoming: DecryptedMessage[]): void {
    if (incoming.length === 0) {
        return
    }

    updateState(sessionId, (prev) => {
        if (prev.atBottom) {
            const overlayMessages = trimVisibleMessages(mergeMessages(prev.overlayMessages, incoming), 'append')
            const visibleMessages = mergeMessages(materializeCanonicalMessages(prev.items), overlayMessages)
            const pending = filterPendingAgainstVisible(prev.pending, visibleMessages)
            return buildState(prev, { overlayMessages, pending })
        }

        const agentMessages = incoming.filter((message) => !isUserMessage(message))
        const userMessages = incoming.filter((message) => isUserMessage(message))

        let state = prev
        if (agentMessages.length > 0) {
            const overlayMessages = trimVisibleMessages(mergeMessages(state.overlayMessages, agentMessages), 'append')
            const visibleMessages = mergeMessages(materializeCanonicalMessages(state.items), overlayMessages)
            const pending = filterPendingAgainstVisible(state.pending, visibleMessages)
            state = buildState(state, { overlayMessages, pending })
        }
        if (userMessages.length > 0) {
            const pendingResult = mergeIntoPending(state, userMessages)
            state = buildState(state, {
                pending: pendingResult.pending,
                pendingVisibleCount: pendingResult.pendingVisibleCount,
                pendingOverflowCount: pendingResult.pendingOverflowCount,
                pendingOverflowVisibleCount: pendingResult.pendingOverflowVisibleCount,
                warning: pendingResult.warning,
            })
        }
        return state
    })
}

export function flushPendingMessages(sessionId: string): boolean {
    const current = getState(sessionId)
    const hasHiddenCanonical = current.hiddenCanonicalCount > 0
    if (current.pending.length === 0 && current.pendingOverflowVisibleCount === 0 && !hasHiddenCanonical) {
        return false
    }

    const needsRefresh = current.pendingOverflowVisibleCount > 0
    updateState(sessionId, (prev) => {
        const window = selectBottomWindow(prev.roots)
        const overlayMessages = prev.pending.length > 0
            ? trimVisibleMessages(mergeMessages(prev.overlayMessages, prev.pending), 'append')
            : prev.overlayMessages
        return buildState(prev, {
            items: window.items,
            hiddenCanonicalCount: window.hiddenCanonicalCount,
            windowStartIndex: window.windowStartIndex,
            overlayMessages,
            pending: [],
            pendingOverflowCount: 0,
            pendingVisibleCount: 0,
            pendingOverflowVisibleCount: 0,
            warning: needsRefresh ? (prev.warning ?? PENDING_OVERFLOW_WARNING) : prev.warning,
            atBottom: true,
        })
    })

    return needsRefresh
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
    updateState(sessionId, (prev) => {
        const window = selectBottomWindow(prev.roots)
        const overlayMessages = trimVisibleMessages(mergeMessages(prev.overlayMessages, [message]), 'append')
        const visibleMessages = mergeMessages(materializeCanonicalMessages(window.items), overlayMessages)
        const pending = filterPendingAgainstVisible(prev.pending, visibleMessages)
        return buildState(prev, {
            items: window.items,
            hiddenCanonicalCount: window.hiddenCanonicalCount,
            windowStartIndex: window.windowStartIndex,
            overlayMessages,
            pending,
            atBottom: true,
        })
    })
}

export function updateMessageStatus(sessionId: string, localId: string, status: MessageStatus): void {
    if (!localId) {
        return
    }

    updateState(sessionId, (prev) => {
        let changed = false
        const updateList = (list: DecryptedMessage[]) => {
            return list.map((message) => {
                if (message.localId !== localId || !isOptimisticMessage(message)) {
                    return message
                }
                if (message.status === status) {
                    return message
                }
                changed = true
                return { ...message, status }
            })
        }

        const overlayMessages = updateList(prev.overlayMessages)
        const pending = updateList(prev.pending)
        if (!changed) {
            return prev
        }
        return buildState(prev, { overlayMessages, pending })
    })
}
