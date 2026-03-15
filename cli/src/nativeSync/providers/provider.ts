import { createHash } from 'node:crypto'

import type { NativeMessage, NativeProviderName, NativeSessionSummary, NativeSyncState } from '../types'

export type NativeMessageBatch = {
    messages: NativeMessage[]
    cursor: string | null
    filePath?: string | null
    mtime?: number | null
}

export interface NativeSyncProvider {
    name: NativeProviderName
    discoverSessions(): Promise<NativeSessionSummary[]>
    readMessages(summary: NativeSessionSummary, state: NativeSyncState | null): Promise<NativeMessageBatch>
}

function normalizeProjectPath(projectPath: string): string {
    const normalized = projectPath.replaceAll('\\', '/').trim()
    if (normalized.length <= 1) {
        return normalized
    }

    return normalized.replace(/\/+$/, '')
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
