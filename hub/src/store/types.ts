import type {
    CanonicalBlockKind,
    CanonicalRootBlock,
    RawEventEnvelope,
    RawEventProvider
} from '@hapi/protocol'

export type StoredSession = {
    id: string
    tag: string | null
    namespace: string
    machineId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    agentState: unknown | null
    agentStateVersion: number
    todos: unknown | null
    todosUpdatedAt: number | null
    teamState: unknown | null
    teamStateUpdatedAt: number | null
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMachine = {
    id: string
    namespace: string
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredRawEvent = Omit<RawEventEnvelope, 'observationKey'> & {
    observationKey: string | null
    ingestSeq: number
    sortKey: string
}

export type RawEventIngestResult = {
    event: StoredRawEvent
    inserted: boolean
}

export type StoredCanonicalBlock = {
    id: string
    sessionId: string
    generation: number
    timelineSeq: number
    siblingSeq: number
    parentBlockId: string | null
    rootBlockId: string
    depth: number
    kind: CanonicalBlockKind
    createdAt: number
    updatedAt: number
    state: string
    payload: Record<string, unknown>
    sourceRawEventIds: string[]
    parserVersion: number
}

export type StoredCanonicalRootsPageInfo = {
    generation: number
    limit: number
    beforeTimelineSeq: number | null
    nextBeforeTimelineSeq: number | null
    hasMore: boolean
}

export type StoredCanonicalRootsPage = {
    items: CanonicalRootBlock[]
    page: StoredCanonicalRootsPageInfo
}

export type StoredSessionParseState = {
    sessionId: string
    parserVersion: number
    activeGeneration: number
    state: unknown
    lastProcessedRawSortKey: string | null
    lastProcessedRawEventId: string | null
    latestStreamSeq: number
    rebuildRequired: boolean
    lastRebuildStartedAt: number | null
    lastRebuildCompletedAt: number | null
}

export type StoredStagedChildRawEventPayload = Omit<RawEventEnvelope, 'sessionId'>

export type StoredStagedChildRawEvent = {
    id: string
    provider: RawEventProvider
    childIdentity: string
    payload: StoredStagedChildRawEventPayload
    stagedAt: number
}

export type StoredNativeSyncState = {
    sessionId: string
    provider: 'claude' | 'codex'
    nativeSessionId: string
    machineId: string
    cursor: string | null
    filePath: string | null
    mtime: number | null
    lastSyncedAt: number | null
    syncStatus: 'healthy' | 'error'
    lastError: string | null
}

export type StoredUser = {
    id: number
    platform: string
    platformUserId: string
    namespace: string
    createdAt: number
}

export type StoredPushSubscription = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    createdAt: number
}

export type VersionedUpdateResult<T> =
    | { result: 'success'; version: number; value: T }
    | { result: 'version-mismatch'; version: number; value: T }
    | { result: 'error' }
