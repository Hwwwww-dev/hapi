import * as protocol from '@hapi/protocol'
import type {
    DecryptedMessage as ProtocolDecryptedMessage,
    Session,
    SessionSummary,
    SyncEvent as ProtocolSyncEvent,
    WorktreeMetadata
} from '@hapi/protocol/types'

export type {
    AgentState,
    AttachmentMetadata,
    CodexCollaborationMode,
    PermissionMode,
    Session,
    SessionSummary,
    SessionSummaryMetadata,
    TeamMember,
    TeamMessage,
    TeamState,
    TeamTask,
    TodoItem,
    WorktreeMetadata
} from '@hapi/protocol/types'

export type SessionMetadataSummary = {
    path: string
    host: string
    version?: string
    name?: string
    os?: string
    summary?: { text: string; updatedAt: number }
    machineId?: string
    tools?: string[]
    flavor?: string | null
    worktree?: WorktreeMetadata
}

export type MessageStatus = 'sending' | 'sent' | 'failed'

export type DecryptedMessage = ProtocolDecryptedMessage & {
    status?: MessageStatus
    originalText?: string
}

export type RunnerState = {
    status?: string
    pid?: number
    httpPort?: number
    startedAt?: number
    shutdownRequestedAt?: number
    shutdownSource?: string
    lastSpawnError?: {
        message: string
        pid?: number
        exitCode?: number | null
        signal?: string | null
        at: number
    } | null
}

export type Machine = {
    id: string
    active: boolean
    metadata: {
        host: string
        platform: string
        happyCliVersion: string
        displayName?: string
        homeDir?: string
    } | null
    runnerState?: RunnerState | null
}

export type AuthResponse = {
    token: string
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
    }
}

export type SessionGroup = { directory: string; sessions: SessionSummary[]; hasMore: boolean; total: number }
export type SessionsResponse = { groups: SessionGroup[] }
export type SessionResponse = { session: Session }
export type MessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
        total?: number
    }
}

export type MachinesResponse = { machines: Machine[] }
export type MachinePathsExistsResponse = { exists: Record<string, boolean> }

export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }

export type GitCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type FileSearchItem = {
    fileName: string
    filePath: string
    fullPath: string
    fileType: 'file' | 'folder'
}

export type FileSearchResponse = {
    success: boolean
    files?: FileSearchItem[]
    error?: string
}

export type DirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type ListDirectoryResponse = {
    success: boolean
    entries?: DirectoryEntry[]
    error?: string
}

export type CreateMachineDirectoryResponse = {
    success: boolean
    path?: string
    error?: string
}

export type FileReadResponse = {
    success: boolean
    content?: string
    error?: string
}

export type UploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type DeleteUploadResponse = {
    success: boolean
    error?: string
}

export type GitFileStatus = {
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}

export type GitStatusFiles = {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    branch: string | null
    totalStaged: number
    totalUnstaged: number
    ahead: number
}

export type CommitEntry = {
    hash: string
    short: string
    author: string
    email: string
    date: number
    subject: string
}

export type GitBranchEntry = {
    name: string
    isCurrent: boolean
    isRemote: boolean
}

export type StashEntry = {
    index: number
    message: string
}

export type GitRemoteEntry = {
    name: string
    fetchUrl: string
    pushUrl: string
}

export type GitTagEntry = {
    name: string
    hash: string
    short: string
    date: number
    subject: string
    author: string
}

export type SlashCommand = {
    name: string
    description?: string
    source: 'builtin' | 'user' | 'plugin' | 'project'
    content?: string  // Expanded content for Codex user prompts
    pluginName?: string
}

export type SlashCommandsResponse = {
    success: boolean
    commands?: SlashCommand[]
    error?: string
}

export type SkillSummary = {
    name: string
    description?: string
}

export type SkillsResponse = {
    success: boolean
    skills?: SkillSummary[]
    error?: string
}

export type PushSubscriptionKeys = {
    p256dh: string
    auth: string
}

export type PushSubscriptionPayload = {
    endpoint: string
    keys: PushSubscriptionKeys
}

export type PushUnsubscribePayload = {
    endpoint: string
}

export type PushVapidPublicKeyResponse = {
    publicKey: string
}

export type VisibilityPayload = {
    subscriptionId: string
    visibility: 'visible' | 'hidden'
}

export type SyncEvent = ProtocolSyncEvent

type SessionTitleMetadata = {
    name?: string
    summary?: { text?: string }
    path?: string
    nativeProvider?: string | null
    nativeSessionId?: string
}

type SessionTitleTarget = {
    id: string
    metadata?: SessionTitleMetadata | null
}

type SharedTitleHelpers = {
    getExplicitSessionTitle?: (metadata?: SessionTitleMetadata | null) => string | null | undefined
    getSessionPathFallbackTitle?: (sessionId: string, metadata?: SessionTitleMetadata | null) => string
    getSessionListFallbackTitle?: (sessionId: string, metadata?: SessionTitleMetadata | null) => string
}

const sharedTitleHelpers = protocol as typeof protocol & SharedTitleHelpers

function getLocalPathFallbackTitle(session: SessionTitleTarget): string {
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }

    return session.id.slice(0, 8)
}

function getLocalListFallbackTitle(session: SessionTitleTarget): string {
    const nativeSessionId = session.metadata?.nativeSessionId?.trim()
    if (nativeSessionId) {
        const provider = session.metadata?.nativeProvider?.trim()
        return provider ? `${provider} ${nativeSessionId.slice(0, 8)}` : nativeSessionId.slice(0, 8)
    }

    return getLocalPathFallbackTitle(session)
}

export function getExplicitSessionTitle(session: SessionTitleTarget): string | undefined {
    if (sharedTitleHelpers.getExplicitSessionTitle) {
        return sharedTitleHelpers.getExplicitSessionTitle(session.metadata) ?? undefined
    }

    return session.metadata?.name || session.metadata?.summary?.text || undefined
}

export function getSessionPathFallbackTitle(session: SessionTitleTarget): string {
    if (sharedTitleHelpers.getSessionPathFallbackTitle) {
        return sharedTitleHelpers.getSessionPathFallbackTitle(session.id, session.metadata)
    }

    return getLocalPathFallbackTitle(session)
}

export function getSessionListFallbackTitle(session: SessionTitleTarget): string {
    if (sharedTitleHelpers.getSessionListFallbackTitle) {
        return sharedTitleHelpers.getSessionListFallbackTitle(session.id, session.metadata)
    }

    return getLocalListFallbackTitle(session)
}
