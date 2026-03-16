import type { RawEventEnvelope } from '@hapi/protocol'

export type NativeProviderName = 'claude' | 'codex'

export type NativeSessionSummary = {
    provider: NativeProviderName
    nativeSessionId: string
    projectPath: string
    displayPath: string
    flavor: 'claude' | 'codex'
    createdAt: number
    discoveredAt: number
    lastActivityAt: number
    title?: string
}

export type NativeRawEvent = RawEventEnvelope

export type NativeSyncState = {
    sessionId: string
    provider: NativeProviderName
    nativeSessionId: string
    machineId: string
    cursor: string | null
    filePath: string | null
    mtime: number | null
    lastSyncedAt: number | null
    syncStatus: 'healthy' | 'error'
    lastError: string | null
}
