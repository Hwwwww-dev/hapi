import type { CanonicalClosedEventSubtype, RawEventEnvelope, RawEventProvider, RawEventSource } from '@hapi/protocol'

export type ParserRawEvent = RawEventEnvelope

export type ParserSeedBase = {
    rawEventId: string
    provider: RawEventProvider
    source: RawEventSource
    sourceSessionId: string
    sourceKey: string
    channel: string
    occurredAt: number
    observationKey: string | null
}

export type TextSeed = ParserSeedBase & {
    kind: 'user-text' | 'agent-text' | 'reasoning'
    text: string
    payload?: Record<string, unknown>
    scopeKey: string
    partKey: string
    mode: 'one-shot' | 'open' | 'append'
    state: 'streaming' | 'completed'
}

export type ToolCallSeed = ParserSeedBase & {
    kind: 'tool-call'
    toolId: string
    toolName: string
    input: unknown
    description: string | null
    state: 'pending' | 'running' | 'completed' | 'error' | 'canceled'
}

export type ToolResultSeed = ParserSeedBase & {
    kind: 'tool-result'
    toolId: string
    content: unknown
    isError: boolean
    permissions?: unknown
}

export type EventSeed = ParserSeedBase & {
    kind: 'event'
    subtype: CanonicalClosedEventSubtype
    payload: Record<string, unknown>
}

export type FallbackSeed = ParserSeedBase & {
    kind: 'fallback-raw'
    rawType: string
    summary: string
    previewJson: string
}

export type SemanticSeed =
    | TextSeed
    | ToolCallSeed
    | ToolResultSeed
    | EventSeed
    | FallbackSeed

export type ExplicitChildLink = {
    childIdentity: string
    parentToolId: string | null
    title: string | null
    description: string | null
    rawEventId: string
    occurredAt: number
    provider: RawEventProvider
}

export type ProviderParseResult = {
    seeds: SemanticSeed[]
    explicitChildLinks: ExplicitChildLink[]
}
