import type { RawEventEnvelope } from '@hapi/protocol'

import type { FallbackSeed, ParserRawEvent, ProviderParseResult } from './types'

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toCompactString(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim()
    }

    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

function previewJson(value: unknown): string {
    const raw = toCompactString(value)
    return raw.length > 400 ? `${raw.slice(0, 397)}...` : raw
}

function summarizeRawEvent(event: RawEventEnvelope): string {
    if (typeof event.payload === 'string') {
        const normalized = event.payload.trim()
        return normalized.length > 0 ? normalized.slice(0, 120) : event.rawType
    }

    if (isObject(event.payload)) {
        const textCandidates = [
            event.payload.title,
            event.payload.message,
            event.payload.text,
            event.payload.summary,
            event.payload.content
        ]

        for (const candidate of textCandidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate.trim().slice(0, 120)
            }
        }

        if (typeof event.payload.type === 'string') {
            return `${event.rawType}:${event.payload.type}`
        }
    }

    return event.rawType
}

export function buildFallbackSeed(event: ParserRawEvent): FallbackSeed {
    return {
        kind: 'fallback-raw',
        rawEventId: event.id,
        provider: event.provider,
        source: event.source,
        sourceSessionId: event.sourceSessionId,
        sourceKey: event.sourceKey,
        channel: event.channel,
        occurredAt: event.occurredAt,
        observationKey: event.observationKey ?? null,
        rawType: event.rawType,
        summary: summarizeRawEvent(event),
        previewJson: previewJson(event.payload)
    }
}

export function parseFallbackRawEvent(event: ParserRawEvent): ProviderParseResult {
    return {
        seeds: [buildFallbackSeed(event)],
        explicitChildLinks: []
    }
}
