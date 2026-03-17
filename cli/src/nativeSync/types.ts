export type NativeProviderName = 'claude' | 'codex'

export type NativeSessionSummary = {
    provider: NativeProviderName
    nativeSessionId: string
    parentNativeSessionId?: string
    projectPath: string
    displayPath: string
    flavor: 'claude' | 'codex'
    createdAt: number
    discoveredAt: number
    lastActivityAt: number
    title?: string
}

export type NativeMessage = {
    sourceKey: string
    createdAt: number
    content: unknown
}

export type NativeMessageImport = NativeMessage & {
    sourceProvider: NativeProviderName
    sourceSessionId: string
}

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
