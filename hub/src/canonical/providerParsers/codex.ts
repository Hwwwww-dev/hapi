import type { ParserRawEvent, ProviderParseResult, SemanticSeed } from './types'
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

function extractCallId(payload: Record<string, unknown>): string | null {
    return firstString(
        payload.call_id,
        payload.callId,
        payload.tool_call_id,
        payload.toolCallId,
        payload.id
    )
}

function normalizeReasoningScope(event: ParserRawEvent): string {
    return `${event.provider}:${event.sourceSessionId}:${event.channel}:reasoning`
}

function parseConvertedCodexPayload(event: ParserRawEvent, payload: Record<string, unknown>): ProviderParseResult | null {
    const base = buildSeedBase(event)

    if (payload.type === 'message' && typeof payload.message === 'string') {
        return {
            seeds: [{
                ...base,
                kind: 'agent-text',
                text: payload.message.trim(),
                scopeKey: `${event.channel}:assistant`,
                partKey: `${event.id}:message`,
                mode: 'one-shot',
                state: 'completed'
            }],
            explicitChildLinks: []
        }
    }

    if (payload.type === 'reasoning' && typeof payload.message === 'string') {
        return {
            seeds: [{
                ...base,
                kind: 'reasoning',
                text: payload.message.trim(),
                scopeKey: normalizeReasoningScope(event),
                partKey: `${event.id}:reasoning`,
                mode: 'open',
                state: 'streaming'
            }],
            explicitChildLinks: []
        }
    }

    if (payload.type === 'reasoning-delta' && typeof payload.delta === 'string') {
        return {
            seeds: [{
                ...base,
                kind: 'reasoning',
                text: payload.delta,
                scopeKey: normalizeReasoningScope(event),
                partKey: `${event.id}:reasoning-delta`,
                mode: 'append',
                state: 'streaming'
            }],
            explicitChildLinks: []
        }
    }

    if (payload.type === 'tool-call') {
        const toolId = firstString(payload.callId, payload.id)
        if (!toolId) {
            return null
        }

        return {
            seeds: [{
                ...base,
                kind: 'tool-call',
                toolId,
                toolName: asString(payload.name) ?? 'Tool',
                input: payload.input ?? null,
                description: null,
                state: 'running'
            }],
            explicitChildLinks: []
        }
    }

    if (payload.type === 'tool-call-result' || payload.type === 'tool_result') {
        const toolId = firstString(payload.callId, payload.tool_use_id, payload.id)
        if (!toolId) {
            return null
        }

        return {
            seeds: [{
                ...base,
                kind: 'tool-result',
                toolId,
                content: payload.output ?? payload.content ?? null,
                isError: Boolean(payload.is_error)
            }],
            explicitChildLinks: []
        }
    }

    if (payload.type === 'token_count') {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'token-count',
                payload: {
                    subtype: 'token-count',
                    info: isObject(payload.info) ? payload.info : {}
                }
            }],
            explicitChildLinks: []
        }
    }

    if (payload.type === 'plan' && Array.isArray(payload.entries)) {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'plan-updated',
                payload: {
                    subtype: 'plan-updated',
                    entries: payload.entries
                }
            }],
            explicitChildLinks: []
        }
    }

    return null
}

function parseEventMsgPayload(event: ParserRawEvent, payload: Record<string, unknown>): ProviderParseResult | null {
    const eventType = asString(payload.type)
    if (!eventType) {
        return null
    }

    const base = buildSeedBase(event)

    if (eventType === 'user_message') {
        const text = firstString(payload.message, payload.text, payload.content)
        if (!text) {
            return null
        }
        return {
            seeds: [{
                ...base,
                kind: 'user-text',
                text,
                scopeKey: `${event.channel}:user`,
                partKey: `${event.id}:user`,
                mode: 'one-shot',
                state: 'completed'
            }],
            explicitChildLinks: []
        }
    }

    if (eventType === 'agent_message') {
        const text = asString(payload.message)
        if (!text) {
            return null
        }
        return {
            seeds: [{
                ...base,
                kind: 'agent-text',
                text,
                scopeKey: `${event.channel}:assistant`,
                partKey: `${event.id}:assistant`,
                mode: 'one-shot',
                state: 'completed'
            }],
            explicitChildLinks: []
        }
    }

    if (eventType === 'agent_reasoning') {
        const text = firstString(payload.text, payload.message)
        if (!text) {
            return null
        }
        return {
            seeds: [{
                ...base,
                kind: 'reasoning',
                text,
                scopeKey: normalizeReasoningScope(event),
                partKey: `${event.id}:reasoning`,
                mode: 'open',
                state: 'streaming'
            }],
            explicitChildLinks: []
        }
    }

    if (eventType === 'agent_reasoning_delta') {
        const text = firstString(payload.delta, payload.text, payload.message)
        if (!text) {
            return null
        }
        return {
            seeds: [{
                ...base,
                kind: 'reasoning',
                text,
                scopeKey: normalizeReasoningScope(event),
                partKey: `${event.id}:reasoning-delta`,
                mode: 'append',
                state: 'streaming'
            }],
            explicitChildLinks: []
        }
    }

    if (eventType === 'token_count') {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'token-count',
                payload: {
                    subtype: 'token-count',
                    info: isObject(payload.info) ? payload.info : { ...payload }
                }
            }],
            explicitChildLinks: []
        }
    }

    if (eventType === 'plan_updated' || eventType === 'plan-updated') {
        return {
            seeds: [{
                ...base,
                kind: 'event',
                subtype: 'plan-updated',
                payload: {
                    subtype: 'plan-updated',
                    entries: Array.isArray(payload.entries) ? payload.entries : [],
                    summary: asString(payload.summary) ?? undefined
                }
            }],
            explicitChildLinks: []
        }
    }

    return null
}

function parseResponseItemPayload(event: ParserRawEvent, payload: Record<string, unknown>): ProviderParseResult | null {
    const itemType = asString(payload.type)
    if (!itemType) {
        return null
    }

    const base = buildSeedBase(event)

    if (itemType === 'function_call') {
        const toolId = extractCallId(payload)
        if (!toolId) {
            return null
        }

        return {
            seeds: [{
                ...base,
                kind: 'tool-call',
                toolId,
                toolName: asString(payload.name) ?? 'Tool',
                input: payload.arguments ?? payload.input ?? null,
                description: null,
                state: 'running'
            }],
            explicitChildLinks: []
        }
    }

    if (itemType === 'function_call_output') {
        const toolId = extractCallId(payload)
        if (!toolId) {
            return null
        }

        return {
            seeds: [{
                ...base,
                kind: 'tool-result',
                toolId,
                content: payload.output ?? null,
                isError: Boolean(payload.is_error)
            }],
            explicitChildLinks: []
        }
    }

    return null
}

export function parseCodexRawEvent(event: ParserRawEvent): ProviderParseResult {
    if (!isObject(event.payload)) {
        return {
            seeds: [buildFallbackSeed(event)],
            explicitChildLinks: []
        }
    }

    const converted = parseConvertedCodexPayload(event, event.payload)
    if (converted) {
        return converted
    }

    if (event.rawType === 'event_msg') {
        return parseEventMsgPayload(event, event.payload) ?? {
            seeds: [buildFallbackSeed(event)],
            explicitChildLinks: []
        }
    }

    if (event.rawType === 'response_item') {
        return parseResponseItemPayload(event, event.payload) ?? {
            seeds: [buildFallbackSeed(event)],
            explicitChildLinks: []
        }
    }

    return {
        seeds: [buildFallbackSeed(event)],
        explicitChildLinks: []
    }
}
