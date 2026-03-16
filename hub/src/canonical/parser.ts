import type { CanonicalRootBlock, RawEventEnvelope } from '@hapi/protocol'

import { parseClaudeRawEvent } from './providerParsers/claude'
import { parseCodexRawEvent } from './providerParsers/codex'
import { parseFallbackRawEvent } from './providerParsers/fallback'
import type {
    ExplicitChildLink,
    FallbackSeed,
    ParserRawEvent,
    ProviderParseResult,
    SemanticSeed,
    TextSeed,
    ToolCallSeed,
    ToolResultSeed,
    EventSeed
} from './providerParsers/types'

export type ParserEmittedOp = {
    op: 'append' | 'replace'
    root: CanonicalRootBlock
}

export type SessionParserState = {
    generation: number
    latestStreamSeq: number
    lastProcessedRawSortKey: string | null
    lastProcessedRawEventId: string | null
    rootIndex: Record<string, { hash: string; timelineSeq: number }>
    roots: CanonicalRootBlock[]
}

type ParseSessionRawEventsInput = {
    sessionId: string
    parserVersion: number
    rawEvents: RawEventEnvelope[]
    previousState?: SessionParserState | null
}

type MutableRoot = {
    id: string
    kind: CanonicalRootBlock['kind']
    createdAt: number
    updatedAt: number
    state: string
    payload: Record<string, unknown>
    sourceRawEventIds: string[]
    children: MutableRoot[]
    sourceRank: number
    firstSortKey: string
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function toJsonHash(value: unknown): string {
    return JSON.stringify(value)
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values)]
}

function sourceRank(source: RawEventEnvelope['source']): number {
    return source === 'native' ? 0 : 1
}

export function createRawSortKey(event: Pick<RawEventEnvelope, 'occurredAt' | 'source' | 'channel' | 'sourceOrder' | 'sourceKey' | 'id'>): string {
    const occurredAt = `${Math.max(0, Math.trunc(event.occurredAt))}`.padStart(16, '0')
    const source = event.source === 'native' ? '0' : '1'
    const sourceOrder = `${Math.max(0, Math.trunc(event.sourceOrder))}`.padStart(16, '0')
    return `${occurredAt}|${source}|${event.channel}|${sourceOrder}|${event.sourceKey}|${event.id}`
}

function compareRawEvents(left: ParserRawEvent, right: ParserRawEvent): number {
    return createRawSortKey(left).localeCompare(createRawSortKey(right))
}

function anchorIdentityForEvent(event: ParserRawEvent): string {
    if (event.observationKey) {
        return `obs:${event.provider}|${event.sourceSessionId}|${event.observationKey}`
    }
    return `raw:${event.id}`
}

function buildBlockId(sessionId: string, anchorIdentity: string, canonicalPath: string): string {
    return `${sessionId}:${anchorIdentity}:${canonicalPath}`
}

function rootPayloadTitle(payload: Record<string, unknown>): string | null {
    if (!isObject(payload.input)) {
        return null
    }

    return asString(payload.input.prompt)
        ?? asString(payload.input.description)
        ?? asString(payload.input.title)
        ?? null
}

function parseProviderRawEvent(event: ParserRawEvent): ProviderParseResult {
    if (event.provider === 'claude') {
        return parseClaudeRawEvent(event)
    }
    if (event.provider === 'codex') {
        return parseCodexRawEvent(event)
    }
    return parseFallbackRawEvent(event)
}

function collectExplicitChildLinks(rawEvents: ParserRawEvent[]): Map<string, ExplicitChildLink> {
    const links = new Map<string, ExplicitChildLink>()

    for (const event of rawEvents) {
        const result = parseProviderRawEvent(event)
        for (const link of result.explicitChildLinks) {
            const existing = links.get(link.childIdentity)
            if (!existing || link.occurredAt < existing.occurredAt || (link.occurredAt === existing.occurredAt && link.rawEventId < existing.rawEventId)) {
                links.set(link.childIdentity, link)
            }
        }
    }

    return links
}

function resolveChildIdentity(event: ParserRawEvent, links: Map<string, ExplicitChildLink>): string | null {
    if (links.has(event.sourceSessionId)) {
        return event.sourceSessionId
    }

    if (isObject(event.payload)) {
        const candidate = asString(event.payload.childIdentity) ?? asString(event.payload.childSessionId)
        if (candidate && links.has(candidate)) {
            return candidate
        }
    }

    return null
}

function upsertRoot(rootById: Map<string, MutableRoot>, rootOrder: MutableRoot[], next: MutableRoot): MutableRoot {
    const existing = rootById.get(next.id)
    if (!existing) {
        rootById.set(next.id, next)
        rootOrder.push(next)
        return next
    }

    existing.updatedAt = Math.max(existing.updatedAt, next.updatedAt)
    existing.sourceRawEventIds = uniqueStrings([...existing.sourceRawEventIds, ...next.sourceRawEventIds])
    existing.firstSortKey = existing.firstSortKey <= next.firstSortKey ? existing.firstSortKey : next.firstSortKey

    if (next.sourceRank <= existing.sourceRank) {
        existing.payload = next.payload
        existing.state = next.state
        existing.sourceRank = next.sourceRank
    } else {
        existing.payload = mergePayloadPreferringExisting(existing.payload, next.payload)
    }

    return existing
}

function mergePayloadPreferringExisting(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...existing }
    for (const [key, value] of Object.entries(incoming)) {
        const current = merged[key]
        if (current === null || current === undefined || current === '') {
            merged[key] = value
        }
    }
    return merged
}

function createMutableRoot(params: {
    id: string
    kind: MutableRoot['kind']
    createdAt: number
    updatedAt: number
    state: string
    payload: Record<string, unknown>
    sourceRawEventIds: string[]
    sourceRank: number
    firstSortKey: string
}): MutableRoot {
    return {
        id: params.id,
        kind: params.kind,
        createdAt: params.createdAt,
        updatedAt: params.updatedAt,
        state: params.state,
        payload: params.payload,
        sourceRawEventIds: params.sourceRawEventIds,
        children: [],
        sourceRank: params.sourceRank,
        firstSortKey: params.firstSortKey
    }
}

function closeReasoningScopes(openReasoningByScope: Map<string, string>, channel: string): void {
    for (const scopeKey of [...openReasoningByScope.keys()]) {
        if (scopeKey === `${channel}:reasoning` || scopeKey.includes(`:${channel}:reasoning`) || scopeKey.endsWith(`:${channel}`)) {
            openReasoningByScope.delete(scopeKey)
        }
    }
}

function processTextSeed(
    sessionId: string,
    seed: TextSeed,
    rootById: Map<string, MutableRoot>,
    rootOrder: MutableRoot[],
    openReasoningByScope: Map<string, string>
): void {
    const rank = sourceRank(seed.source)
    const anchorIdentity = anchorIdentityForSeed(seed)
    const firstSortKey = createRawSortKeyFromSeed(seed)

    if (seed.kind !== 'reasoning') {
        openReasoningByScope.delete(seed.scopeKey)
    }

    if (seed.kind === 'reasoning' && seed.mode === 'append') {
        const openRootId = openReasoningByScope.get(seed.scopeKey)
        if (openRootId) {
            const existing = rootById.get(openRootId)
            if (existing) {
                const currentText = typeof existing.payload.text === 'string' ? existing.payload.text : ''
                existing.payload = { ...existing.payload, text: `${currentText}${seed.text}` }
                existing.updatedAt = Math.max(existing.updatedAt, seed.occurredAt)
                existing.sourceRawEventIds = uniqueStrings([...existing.sourceRawEventIds, seed.rawEventId])
                existing.state = seed.state
                return
            }
        }
    }

    const rootId = buildBlockId(sessionId, anchorIdentity, `${seed.kind}:${seed.partKey}`)
    const mutable = createMutableRoot({
        id: rootId,
        kind: seed.kind,
        createdAt: seed.occurredAt,
        updatedAt: seed.occurredAt,
        state: seed.state,
        payload: { text: seed.text },
        sourceRawEventIds: [seed.rawEventId],
        sourceRank: rank,
        firstSortKey
    })

    const root = upsertRoot(rootById, rootOrder, mutable)
    if (seed.kind === 'reasoning' && (seed.mode === 'open' || seed.mode === 'append')) {
        openReasoningByScope.set(seed.scopeKey, root.id)
    }
}

function processToolCallSeed(
    sessionId: string,
    seed: ToolCallSeed,
    rootById: Map<string, MutableRoot>,
    rootOrder: MutableRoot[],
    toolRootByToolId: Map<string, string>,
    openReasoningByScope: Map<string, string>
): void {
    closeReasoningScopes(openReasoningByScope, seed.channel)
    const rootId = buildBlockId(sessionId, anchorIdentityForSeed(seed), `tool-call:${seed.toolId}`)
    const root = upsertRoot(rootById, rootOrder, createMutableRoot({
        id: rootId,
        kind: 'tool-call',
        createdAt: seed.occurredAt,
        updatedAt: seed.occurredAt,
        state: seed.state,
        payload: {
            toolId: seed.toolId,
            toolName: seed.toolName,
            input: seed.input,
            description: seed.description,
            state: seed.state
        },
        sourceRawEventIds: [seed.rawEventId],
        sourceRank: sourceRank(seed.source),
        firstSortKey: createRawSortKeyFromSeed(seed)
    }))

    toolRootByToolId.set(seed.toolId, root.id)
}

function processToolResultSeed(
    sessionId: string,
    seed: ToolResultSeed,
    rootById: Map<string, MutableRoot>,
    rootOrder: MutableRoot[],
    toolRootByToolId: Map<string, string>,
    openReasoningByScope: Map<string, string>
): void {
    closeReasoningScopes(openReasoningByScope, seed.channel)
    const existingToolRootId = toolRootByToolId.get(seed.toolId)
    if (existingToolRootId) {
        const existingToolRoot = rootById.get(existingToolRootId)
        if (existingToolRoot) {
            existingToolRoot.updatedAt = Math.max(existingToolRoot.updatedAt, seed.occurredAt)
            existingToolRoot.sourceRawEventIds = uniqueStrings([...existingToolRoot.sourceRawEventIds, seed.rawEventId])
            existingToolRoot.state = seed.isError ? 'error' : 'completed'
            existingToolRoot.payload = {
                ...existingToolRoot.payload,
                result: seed.content,
                state: seed.isError ? 'error' : 'completed',
                ...(seed.permissions !== undefined ? { permissions: seed.permissions } : {})
            }
            return
        }
    }

    upsertRoot(rootById, rootOrder, createMutableRoot({
        id: buildBlockId(sessionId, anchorIdentityForSeed(seed), `tool-result:${seed.toolId}`),
        kind: 'tool-result',
        createdAt: seed.occurredAt,
        updatedAt: seed.occurredAt,
        state: seed.isError ? 'error' : 'completed',
        payload: {
            toolId: seed.toolId,
            toolName: null,
            content: seed.content,
            isError: seed.isError,
            ...(seed.permissions !== undefined ? { permissions: seed.permissions } : {})
        },
        sourceRawEventIds: [seed.rawEventId],
        sourceRank: sourceRank(seed.source),
        firstSortKey: createRawSortKeyFromSeed(seed)
    }))
}

function processEventSeed(
    sessionId: string,
    seed: EventSeed,
    rootById: Map<string, MutableRoot>,
    rootOrder: MutableRoot[],
    openReasoningByScope: Map<string, string>
): void {
    closeReasoningScopes(openReasoningByScope, seed.channel)
    upsertRoot(rootById, rootOrder, createMutableRoot({
        id: buildBlockId(sessionId, anchorIdentityForSeed(seed), `event:${seed.subtype}`),
        kind: 'event',
        createdAt: seed.occurredAt,
        updatedAt: seed.occurredAt,
        state: 'completed',
        payload: seed.payload,
        sourceRawEventIds: [seed.rawEventId],
        sourceRank: sourceRank(seed.source),
        firstSortKey: createRawSortKeyFromSeed(seed)
    }))
}

function processFallbackSeed(
    sessionId: string,
    seed: FallbackSeed,
    rootById: Map<string, MutableRoot>,
    rootOrder: MutableRoot[],
    openReasoningByScope: Map<string, string>
): void {
    closeReasoningScopes(openReasoningByScope, seed.channel)
    upsertRoot(rootById, rootOrder, createMutableRoot({
        id: buildBlockId(sessionId, anchorIdentityForSeed(seed), `fallback:${seed.rawType}`),
        kind: 'fallback-raw',
        createdAt: seed.occurredAt,
        updatedAt: seed.occurredAt,
        state: 'completed',
        payload: {
            provider: seed.provider,
            rawType: seed.rawType,
            summary: seed.summary,
            previewJson: seed.previewJson
        },
        sourceRawEventIds: [seed.rawEventId],
        sourceRank: sourceRank(seed.source),
        firstSortKey: createRawSortKeyFromSeed(seed)
    }))
}

function anchorIdentityForSeed(seed: SemanticSeed): string {
    if (seed.observationKey) {
        return `obs:${seed.provider}|${seed.sourceSessionId}|${seed.observationKey}`
    }
    return `raw:${seed.rawEventId}`
}

function createRawSortKeyFromSeed(seed: SemanticSeed): string {
    const detail = 'partKey' in seed
        ? seed.partKey
        : ('toolId' in seed ? seed.toolId : ('subtype' in seed ? seed.subtype : ('rawType' in seed ? seed.rawType : seed.rawEventId)))

    return createRawSortKey({
        occurredAt: seed.occurredAt,
        source: seed.source,
        channel: seed.channel,
        sourceOrder: 0,
        sourceKey: `${seed.sourceKey}|${detail}`,
        id: seed.rawEventId
    })
}

function parseFlatRawEventsToMutableRoots(
    sessionId: string,
    rawEvents: ParserRawEvent[],
    existingRoots: CanonicalRootBlock[] = []
): MutableRoot[] {
    const rootById = new Map<string, MutableRoot>()
    const rootOrder: MutableRoot[] = []
    const toolRootByToolId = new Map<string, string>()
    const openReasoningByScope = new Map<string, string>()

    for (const existingRoot of existingRoots) {
        const mutable = canonicalRootToMutableRoot(existingRoot)
        rootById.set(mutable.id, mutable)
        rootOrder.push(mutable)
        if (mutable.kind === 'tool-call') {
            const toolId = asString(mutable.payload.toolId)
            if (toolId) {
                toolRootByToolId.set(toolId, mutable.id)
            }
        }
    }

    for (const rawEvent of rawEvents) {
        const result = parseProviderRawEvent(rawEvent)
        for (const seed of result.seeds) {
            switch (seed.kind) {
                case 'user-text':
                case 'agent-text':
                case 'reasoning':
                    processTextSeed(sessionId, seed, rootById, rootOrder, openReasoningByScope)
                    break
                case 'tool-call':
                    processToolCallSeed(sessionId, seed, rootById, rootOrder, toolRootByToolId, openReasoningByScope)
                    break
                case 'tool-result':
                    processToolResultSeed(sessionId, seed, rootById, rootOrder, toolRootByToolId, openReasoningByScope)
                    break
                case 'event':
                    processEventSeed(sessionId, seed, rootById, rootOrder, openReasoningByScope)
                    break
                case 'fallback-raw':
                    processFallbackSeed(sessionId, seed, rootById, rootOrder, openReasoningByScope)
                    break
            }
        }
    }

    return rootOrder.sort((left, right) => left.firstSortKey.localeCompare(right.firstSortKey) || left.id.localeCompare(right.id))
}

function toCanonicalRoots(
    sessionId: string,
    parserVersion: number,
    generation: number,
    roots: MutableRoot[]
): CanonicalRootBlock[] {
    return roots.map((root, rootIndex) => {
        const rootBlockId = root.id
        const children = root.children
            .sort((left, right) => left.firstSortKey.localeCompare(right.firstSortKey) || left.id.localeCompare(right.id))
            .map((child, index) => hydrateChildBlock(sessionId, parserVersion, generation, rootBlockId, child, 1, index))

        return {
            id: rootBlockId,
            sessionId,
            timelineSeq: rootIndex + 1,
            siblingSeq: 0,
            parentBlockId: null,
            rootBlockId,
            depth: 0,
            kind: root.kind,
            createdAt: root.createdAt,
            updatedAt: root.updatedAt,
            state: root.state,
            payload: root.payload,
            sourceRawEventIds: root.sourceRawEventIds,
            parserVersion,
            generation,
            children
        }
    })
}

function hydrateChildBlock(
    sessionId: string,
    parserVersion: number,
    generation: number,
    rootBlockId: string,
    root: MutableRoot,
    depth: number,
    siblingSeq: number
): CanonicalRootBlock['children'][number] {
    return {
        id: root.id,
        sessionId,
        timelineSeq: 0,
        siblingSeq,
        parentBlockId: depth === 1 ? rootBlockId : null as never,
        rootBlockId,
        depth,
        kind: root.kind,
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
        state: root.state,
        payload: root.payload,
        sourceRawEventIds: root.sourceRawEventIds,
        parserVersion,
        generation,
        children: root.children
            .sort((left, right) => left.firstSortKey.localeCompare(right.firstSortKey) || left.id.localeCompare(right.id))
            .map((child, index) => hydrateNestedChild(sessionId, parserVersion, generation, rootBlockId, root.id, child, depth + 1, index))
    }
}

function hydrateNestedChild(
    sessionId: string,
    parserVersion: number,
    generation: number,
    rootBlockId: string,
    parentBlockId: string,
    root: MutableRoot,
    depth: number,
    siblingSeq: number
): CanonicalRootBlock['children'][number] {
    return {
        id: root.id,
        sessionId,
        timelineSeq: 0,
        siblingSeq,
        parentBlockId,
        rootBlockId,
        depth,
        kind: root.kind,
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
        state: root.state,
        payload: root.payload,
        sourceRawEventIds: root.sourceRawEventIds,
        parserVersion,
        generation,
        children: root.children
            .sort((left, right) => left.firstSortKey.localeCompare(right.firstSortKey) || left.id.localeCompare(right.id))
            .map((child, index) => hydrateNestedChild(sessionId, parserVersion, generation, rootBlockId, root.id, child, depth + 1, index))
    }
}

function buildSubagentRoots(
    sessionId: string,
    parserVersion: number,
    generation: number,
    childLinks: Map<string, ExplicitChildLink>,
    childEventsByIdentity: Map<string, ParserRawEvent[]>,
    parentCanonicalRoots: CanonicalRootBlock[]
): MutableRoot[] {
    const parentToolRoots = new Map<string, CanonicalRootBlock>()
    for (const root of parentCanonicalRoots) {
        if (root.kind !== 'tool-call') {
            continue
        }
        const toolId = asString(root.payload.toolId)
        if (toolId) {
            parentToolRoots.set(toolId, root)
        }
    }

    const roots: MutableRoot[] = []
    for (const [childIdentity, link] of childLinks.entries()) {
        const childEvents = childEventsByIdentity.get(childIdentity) ?? []
        const childMutableRoots = parseSessionRawEvents({
            sessionId,
            parserVersion,
            rawEvents: childEvents,
            previousState: null
        }).roots.map((root) => canonicalRootToMutableRoot(root))

        const parentTool = link.parentToolId ? parentToolRoots.get(link.parentToolId) : undefined
        const title = link.title ?? (parentTool ? rootPayloadTitle(parentTool.payload) : null)
        const description = link.description ?? (parentTool && typeof parentTool.payload.description === 'string' ? parentTool.payload.description : null)
        const state = parentTool?.state ?? 'completed'
        const firstSortKey = childMutableRoots[0]?.firstSortKey ?? `${String(link.occurredAt).padStart(16, '0')}|2|subagent|0000000000000000|${childIdentity}|${link.rawEventId}`
        const rootId = buildBlockId(sessionId, `subagent:${childIdentity}`, `subagent-root:${childIdentity}`)
        const subagentRoot = createMutableRoot({
            id: rootId,
            kind: 'subagent-root',
            createdAt: Math.min(link.occurredAt, childMutableRoots[0]?.createdAt ?? link.occurredAt),
            updatedAt: Math.max(link.occurredAt, childMutableRoots.at(-1)?.updatedAt ?? link.occurredAt),
            state,
            payload: {
                childIdentity,
                title,
                description,
                provider: link.provider,
                parentToolId: link.parentToolId
            },
            sourceRawEventIds: uniqueStrings([link.rawEventId, ...childMutableRoots.flatMap((root) => root.sourceRawEventIds)]),
            sourceRank: 0,
            firstSortKey
        })
        subagentRoot.children = childMutableRoots
        roots.push(subagentRoot)
    }

    return roots
}

function canonicalRootToMutableRoot(root: CanonicalRootBlock): MutableRoot {
    return {
        id: root.id,
        kind: root.kind,
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
        state: root.state,
        payload: root.payload,
        sourceRawEventIds: [...root.sourceRawEventIds],
        children: root.children.map(childToMutableRoot),
        sourceRank: 0,
        firstSortKey: `${String(root.createdAt).padStart(16, '0')}|${String(root.timelineSeq).padStart(8, '0')}|${root.id}`
    }
}

function childToMutableRoot(child: CanonicalRootBlock['children'][number]): MutableRoot {
    return {
        id: child.id,
        kind: child.kind,
        createdAt: child.createdAt,
        updatedAt: child.updatedAt,
        state: child.state,
        payload: child.payload,
        sourceRawEventIds: [...child.sourceRawEventIds],
        children: child.children.map(childToMutableRoot),
        sourceRank: 0,
        firstSortKey: `${String(child.createdAt).padStart(16, '0')}|${String(child.siblingSeq).padStart(8, '0')}|${child.id}`
    }
}

function computeEmittedOps(
    roots: CanonicalRootBlock[],
    previousState: SessionParserState | null | undefined
): ParserEmittedOp[] {
    const previousIndex = previousState?.rootIndex ?? {}
    const ops: ParserEmittedOp[] = []

    for (const root of roots) {
        const hash = toJsonHash(root)
        const previous = previousIndex[root.id]
        if (!previous) {
            ops.push({ op: 'append', root })
            continue
        }
        if (previous.hash !== hash) {
            ops.push({ op: 'replace', root })
        }
    }

    return ops
}

export function parseSessionRawEvents(input: ParseSessionRawEventsInput): {
    roots: CanonicalRootBlock[]
    nextState: SessionParserState
    emittedOps: ParserEmittedOp[]
    rebuildRequired: boolean
} {
    const orderedRawEvents = [...input.rawEvents].sort(compareRawEvents)
    const childLinks = collectExplicitChildLinks(orderedRawEvents)
    const parentEvents: ParserRawEvent[] = []
    const childEventsByIdentity = new Map<string, ParserRawEvent[]>()

    for (const event of orderedRawEvents) {
        const childIdentity = resolveChildIdentity(event, childLinks)
        if (childIdentity) {
            const group = childEventsByIdentity.get(childIdentity) ?? []
            group.push(event)
            childEventsByIdentity.set(childIdentity, group)
            continue
        }
        parentEvents.push(event)
    }

    const previousRoots = input.previousState?.roots ?? []
    const previousParentRoots = previousRoots.filter((root) => root.kind !== 'subagent-root')
    const parentMutableRoots = parseFlatRawEventsToMutableRoots(input.sessionId, parentEvents, previousParentRoots)
    const generation = input.previousState?.generation ?? 1
    const parentCanonicalRoots = toCanonicalRoots(input.sessionId, input.parserVersion, generation, parentMutableRoots)
    const subagentMutableRoots = buildSubagentRoots(
        input.sessionId,
        input.parserVersion,
        generation,
        childLinks,
        childEventsByIdentity,
        parentCanonicalRoots
    )
    const combinedMutableRoots = [...parentMutableRoots, ...subagentMutableRoots]
        .sort((left, right) => left.firstSortKey.localeCompare(right.firstSortKey) || left.id.localeCompare(right.id))
    const roots = toCanonicalRoots(input.sessionId, input.parserVersion, generation, combinedMutableRoots)
    const emittedOps = computeEmittedOps(roots, input.previousState)
    const lastRawEvent = orderedRawEvents.at(-1)
    const nextState: SessionParserState = {
        generation,
        latestStreamSeq: (input.previousState?.latestStreamSeq ?? 0) + emittedOps.length,
        lastProcessedRawSortKey: lastRawEvent ? createRawSortKey(lastRawEvent) : null,
        lastProcessedRawEventId: lastRawEvent?.id ?? null,
        rootIndex: Object.fromEntries(roots.map((root) => [root.id, {
            hash: toJsonHash(root),
            timelineSeq: root.timelineSeq
        }])),
        roots
    }

    return {
        roots,
        nextState,
        emittedOps,
        rebuildRequired: false
    }
}
