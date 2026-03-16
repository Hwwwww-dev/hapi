import { createHash } from 'node:crypto'
import { relative, sep } from 'node:path'

import type { RawEventEnvelope } from '@hapi/protocol'
import type { NativeProviderName, NativeSessionSummary, NativeSyncState } from '../types'

export type NativeReadContext = {
    sessionId: string
    ingestedAt: number
}

export type NativeMessageBatch = {
    events: RawEventEnvelope[]
    cursor: string | null
    filePath?: string | null
    mtime?: number | null
}

export interface NativeSyncProvider {
    name: NativeProviderName
    discoverSessions(): Promise<NativeSessionSummary[]>
    readMessages(
        summary: NativeSessionSummary,
        state: NativeSyncState | null,
        context?: NativeReadContext
    ): Promise<NativeMessageBatch>
}

function normalizeProjectPath(projectPath: string): string {
    const normalized = projectPath.replaceAll('\\', '/').trim()
    if (normalized.length <= 1) {
        return normalized
    }

    return normalized.replace(/\/+$/, '')
}

function normalizeSourcePath(value: string): string {
    return value.replaceAll('\\', '/')
}

function buildProjectKey(projectPath: string): string {
    return createHash('sha1')
        .update(normalizeProjectPath(projectPath))
        .digest('hex')
        .slice(0, 12)
}

export function buildStableNativeTag(summary: NativeSessionSummary): string {
    return `native:${summary.provider}:${buildProjectKey(summary.projectPath)}:${summary.nativeSessionId}`
}

export function buildNativeRawEventId(
    identity: Pick<RawEventEnvelope, 'provider' | 'source' | 'sourceSessionId' | 'sourceKey'>
): string {
    return createHash('sha1')
        .update([
            identity.provider,
            identity.source,
            identity.sourceSessionId,
            identity.sourceKey
        ].join('|'))
        .digest('hex')
}

export function resolveNativeReadContext(
    summary: NativeSessionSummary,
    context?: NativeReadContext
): NativeReadContext {
    return {
        sessionId: context?.sessionId || summary.nativeSessionId,
        ingestedAt: context?.ingestedAt ?? 0
    }
}

export function buildNativeFileChannel(
    provider: NativeProviderName,
    filePath: string,
    sourceRoot?: string | null
): string {
    if (sourceRoot) {
        const relativePath = relative(sourceRoot, filePath).split(sep).filter(Boolean).join('/')
        return `${provider}:file:${relativePath || normalizeSourcePath(filePath)}`
    }

    return `${provider}:file:${normalizeSourcePath(filePath)}`
}

export function createNativeRawEvent(options: {
    sessionId: string
    provider: NativeProviderName
    sourceSessionId: string
    sourceKey: string
    observationKey?: string | null
    channel: string
    sourceOrder: number
    occurredAt: number
    ingestedAt: number
    rawType: string
    payload: unknown
}): RawEventEnvelope {
    const source = 'native'

    return {
        id: buildNativeRawEventId({
            provider: options.provider,
            source,
            sourceSessionId: options.sourceSessionId,
            sourceKey: options.sourceKey
        }),
        sessionId: options.sessionId,
        provider: options.provider,
        source,
        sourceSessionId: options.sourceSessionId,
        sourceKey: options.sourceKey,
        observationKey: options.observationKey ?? null,
        channel: options.channel,
        sourceOrder: Math.max(0, Math.trunc(options.sourceOrder)),
        occurredAt: Math.max(0, Math.trunc(options.occurredAt)),
        ingestedAt: Math.max(0, Math.trunc(options.ingestedAt)),
        rawType: options.rawType,
        payload: options.payload,
        ingestSchemaVersion: 1
    }
}
