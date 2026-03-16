import type { ParserRawEvent, ProviderParseResult, SemanticSeed, ExplicitChildLink } from './types'
import { buildFallbackSeed } from './fallback'

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function firstString(...values: unknown[]): string | null {
    for (const value of values) {
        const normalized = asString(value)
        if (normalized) {
            return normalized
        }
    }
    return null
}

function asArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null
}

function normalizeText(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : null
    }
    return null
}

function normalizeDescription(input: unknown): string | null {
    if (!isObject(input)) {
        return null
    }
    return asString(input.description)
}

function buildSeedBase(event: ParserRawEvent) {
    return {
        rawEventId: event.id,
        provider: event.provider,
        source: event.source,
        sourceSessionId: event.sourceSessionId,
        sourceKey: event.sourceKey,
        channel: event.channel,
        occurredAt: event.occurredAt,
        observationKey: event.observationKey ?? null
    } as const
}

function buildPartKey(event: ParserRawEvent, partIndex: number): string {
    const anchor = event.observationKey ? `obs:${event.observationKey}` : `raw:${event.id}`
    return `${anchor}:part:${partIndex}`
}

function extractToolResultBlocks(payload: Record<string, unknown>): Array<Record<string, unknown>> {
    const message = isObject(payload.message) ? payload.message : null
    const content = message ? asArray(message.content) : null
    if (!content) {
        return []
    }

    return content.filter((item): item is Record<string, unknown> => {
        return isObject(item) && item.type === 'tool_result'
    })
}

function extractExplicitChildLinksFromPayload(event: ParserRawEvent, payload: Record<string, unknown>): ExplicitChildLink[] {
    const toolUseResult = isObject(payload.toolUseResult) ? payload.toolUseResult : null
    const childIdentity = firstString(
        toolUseResult?.agentId,
        payload.agentId,
        payload.childIdentity,
        payload.childSessionId
    )

    if (!childIdentity) {
        return []
    }

    const toolResults = extractToolResultBlocks(payload)
    const parentToolId = firstString(
        toolResults[0]?.tool_use_id,
        payload.parentToolId,
        payload.toolUseId
    )

    return [{
        childIdentity,
        parentToolId,
        title: null,
        description: null,
        rawEventId: event.id,
        occurredAt: event.occurredAt,
        provider: event.provider
    }]
}

function parseSystemEvent(event: ParserRawEvent, payload: Record<string, unknown>): ProviderParseResult | null {
    const subtype = asString(payload.subtype)
    const base = buildSeedBase(event)

    if (subtype === 'api_error') {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'api-error',
                payload: {
                    subtype: 'api-error',
                    retryAttempt: typeof payload.retryAttempt === 'number' ? payload.retryAttempt : 0,
                    maxRetries: typeof payload.maxRetries === 'number' ? payload.maxRetries : 0,
                    error: payload.error ?? null
                }
            }],
            explicitChildLinks: []
        }
    }

    if (subtype === 'turn_duration') {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'turn-duration',
                payload: {
                    subtype: 'turn-duration',
                    durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : 0
                }
            }],
            explicitChildLinks: []
        }
    }

    if (subtype === 'microcompact_boundary') {
        const metadata = isObject(payload.microcompactMetadata) ? payload.microcompactMetadata : null
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'microcompact',
                payload: {
                    subtype: 'microcompact',
                    trigger: asString(metadata?.trigger) ?? 'auto',
                    preTokens: typeof metadata?.preTokens === 'number' ? metadata.preTokens : 0,
                    tokensSaved: typeof metadata?.tokensSaved === 'number' ? metadata.tokensSaved : 0
                }
            }],
            explicitChildLinks: []
        }
    }

    if (subtype === 'compact_boundary') {
        const metadata = isObject(payload.compactMetadata) ? payload.compactMetadata : null
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'compact',
                payload: {
                    subtype: 'compact',
                    trigger: asString(metadata?.trigger) ?? 'auto',
                    preTokens: typeof metadata?.preTokens === 'number' ? metadata.preTokens : 0
                }
            }],
            explicitChildLinks: []
        }
    }

    return null
}

function parseInlineThinkingText(text: string): Array<{ kind: 'agent-text' | 'reasoning'; text: string }> {
    if (!text.includes('<thinking>') || !text.includes('</thinking>')) {
        return [{ kind: 'agent-text', text }]
    }

    const parts: Array<{ kind: 'agent-text' | 'reasoning'; text: string }> = []
    const pattern = /<thinking>([\s\S]*?)<\/thinking>/gi
    let lastIndex = 0

    for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0
        const before = text.slice(lastIndex, index).trim()
        if (before.length > 0) {
            parts.push({ kind: 'agent-text', text: before })
        }

        const reasoning = (match[1] ?? '').trim()
        if (reasoning.length > 0) {
            parts.push({ kind: 'reasoning', text: reasoning })
        }

        lastIndex = index + match[0].length
    }

    const trailing = text.slice(lastIndex).trim()
    if (trailing.length > 0) {
        parts.push({ kind: 'agent-text', text: trailing })
    }

    return parts.length > 0 ? parts : [{ kind: 'agent-text', text }]
}

function parseAssistantContentArray(event: ParserRawEvent, content: unknown[]): SemanticSeed[] {
    const seeds: SemanticSeed[] = []
    const base = buildSeedBase(event)

    for (const [index, block] of content.entries()) {
        if (!isObject(block) || typeof block.type !== 'string') {
            continue
        }

        if (block.type === 'text') {
            const text = normalizeText(block.text)
            if (!text) {
                continue
            }
            for (const [offset, segment] of parseInlineThinkingText(text).entries()) {
                seeds.push({
                    ...base,
                    kind: segment.kind,
                    text: segment.text,
                    scopeKey: `${event.channel}:assistant`,
                    partKey: `${buildPartKey(event, index)}:${offset}`,
                    mode: 'one-shot',
                    state: 'completed'
                })
            }
            continue
        }

        if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim().length > 0) {
            seeds.push({
                ...base,
                kind: 'reasoning',
                text: block.thinking.trim(),
                scopeKey: `${event.channel}:reasoning`,
                partKey: buildPartKey(event, index),
                mode: 'one-shot',
                state: 'completed'
            })
            continue
        }

        if ((block.type === 'tool_use' || block.type === 'tool_call') && typeof block.id === 'string') {
            const toolName = asString(block.name) ?? 'Tool'
            const input = 'input' in block ? block.input : null
            seeds.push({
                ...base,
                kind: 'tool-call',
                toolId: block.id,
                toolName,
                input,
                description: normalizeDescription(input),
                state: 'running'
            })
            continue
        }

        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            seeds.push({
                ...base,
                kind: 'tool-result',
                toolId: block.tool_use_id,
                content: 'content' in block ? block.content : null,
                isError: Boolean(block.is_error),
                permissions: 'permissions' in block ? block.permissions : undefined
            })
        }
    }

    return seeds
}

function parseAssistantPayload(event: ParserRawEvent, payload: Record<string, unknown>): ProviderParseResult {
    const message = isObject(payload.message) ? payload.message : null
    const content = message?.content
    const seeds: SemanticSeed[] = []
    const base = buildSeedBase(event)

    if (typeof content === 'string') {
        for (const [index, segment] of parseInlineThinkingText(content).entries()) {
            seeds.push({
                ...base,
                kind: segment.kind,
                text: segment.text,
                scopeKey: `${event.channel}:${segment.kind}`,
                partKey: buildPartKey(event, index),
                mode: 'one-shot',
                state: 'completed'
            })
        }
    } else if (Array.isArray(content)) {
        seeds.push(...parseAssistantContentArray(event, content))
    }

    return {
        seeds: seeds.length > 0 ? seeds : [buildFallbackSeed(event)],
        explicitChildLinks: extractExplicitChildLinksFromPayload(event, payload)
    }
}

function parseUserPayload(event: ParserRawEvent, payload: Record<string, unknown>): ProviderParseResult {
    const message = isObject(payload.message) ? payload.message : null
    const content = message?.content
    const base = buildSeedBase(event)
    const seeds: SemanticSeed[] = []

    if (typeof content === 'string' && payload.isSidechain !== true && payload.isMeta !== true) {
        const text = content.trim()
        if (text.length > 0) {
            seeds.push({
                ...base,
                kind: 'user-text',
                text,
                scopeKey: `${event.channel}:user`,
                partKey: buildPartKey(event, 0),
                mode: 'one-shot',
                state: 'completed'
            })
        }
    } else if (Array.isArray(content)) {
        for (const [index, block] of content.entries()) {
            if (!isObject(block) || typeof block.type !== 'string') {
                continue
            }

            if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                seeds.push({
                    ...base,
                    kind: 'tool-result',
                    toolId: block.tool_use_id,
                    content: 'content' in block ? block.content : null,
                    isError: Boolean(block.is_error),
                    permissions: 'permissions' in block ? block.permissions : undefined
                })
                continue
            }

            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
                seeds.push({
                    ...base,
                    kind: 'user-text',
                    text: block.text.trim(),
                    scopeKey: `${event.channel}:user`,
                    partKey: buildPartKey(event, index),
                    mode: 'one-shot',
                    state: 'completed'
                })
            }
        }
    }

    return {
        seeds: seeds.length > 0 ? seeds : [buildFallbackSeed(event)],
        explicitChildLinks: extractExplicitChildLinksFromPayload(event, payload)
    }
}

function parseRuntimeEventPayload(event: ParserRawEvent, payload: Record<string, unknown>): ProviderParseResult | null {
    const base = buildSeedBase(event)

    if (payload.type === 'title-changed' && typeof payload.title === 'string') {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'title-changed',
                payload: {
                    subtype: 'title-changed',
                    title: payload.title
                }
            }],
            explicitChildLinks: []
        }
    }

    if (payload.type === 'compact') {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'compact',
                payload: {
                    subtype: 'compact',
                    trigger: asString(payload.trigger) ?? 'auto',
                    preTokens: typeof payload.preTokens === 'number' ? payload.preTokens : 0
                }
            }],
            explicitChildLinks: []
        }
    }

    if (payload.type === 'microcompact') {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'microcompact',
                payload: {
                    subtype: 'microcompact',
                    trigger: asString(payload.trigger) ?? 'auto',
                    preTokens: typeof payload.preTokens === 'number' ? payload.preTokens : 0,
                    tokensSaved: typeof payload.tokensSaved === 'number' ? payload.tokensSaved : 0
                }
            }],
            explicitChildLinks: []
        }
    }

    if (payload.type === 'turn-duration') {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'turn-duration',
                payload: {
                    subtype: 'turn-duration',
                    durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : 0
                }
            }],
            explicitChildLinks: []
        }
    }

    if (payload.type === 'api-error') {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'api-error',
                payload: {
                    subtype: 'api-error',
                    retryAttempt: typeof payload.retryAttempt === 'number' ? payload.retryAttempt : 0,
                    maxRetries: typeof payload.maxRetries === 'number' ? payload.maxRetries : 0,
                    error: payload.error ?? null
                }
            }],
            explicitChildLinks: []
        }
    }

    return null
}

export function parseClaudeRawEvent(event: ParserRawEvent): ProviderParseResult {
    if (!isObject(event.payload)) {
        return {
            seeds: [buildFallbackSeed(event)],
            explicitChildLinks: []
        }
    }

    if (event.rawType === 'system') {
        return parseSystemEvent(event, event.payload) ?? {
            seeds: [buildFallbackSeed(event)],
            explicitChildLinks: []
        }
    }

    if (event.rawType === 'assistant') {
        return parseAssistantPayload(event, event.payload)
    }

    if (event.rawType === 'user') {
        return parseUserPayload(event, event.payload)
    }

    if (event.rawType === 'event') {
        return parseRuntimeEventPayload(event, event.payload) ?? {
            seeds: [buildFallbackSeed(event)],
            explicitChildLinks: []
        }
    }

    if (event.rawType === 'summary' && typeof event.payload.summary === 'string') {
        const base = buildSeedBase(event)
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'compact',
                payload: {
                    subtype: 'compact',
                    trigger: 'summary',
                    preTokens: 0,
                    summary: event.payload.summary
                }
            }],
            explicitChildLinks: []
        }
    }

    return {
        seeds: [buildFallbackSeed(event)],
        explicitChildLinks: extractExplicitChildLinksFromPayload(event, event.payload)
    }
}
