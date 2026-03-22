import type { CodexCollaborationMode, PermissionMode } from '@hapi/protocol/types'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'

export type RpcCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type RpcReadFileResponse = {
    success: boolean
    content?: string
    error?: string
}

export type RpcUploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type RpcDeleteUploadResponse = {
    success: boolean
    error?: string
}

export type RpcDirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type RpcListDirectoryResponse = {
    success: boolean
    entries?: RpcDirectoryEntry[]
    error?: string
}

export type RpcCreateMachineDirectoryResponse = {
    success: boolean
    path?: string
    error?: string
}

export type RpcPathExistsResponse = {
    exists: Record<string, boolean>
}

export class RpcGateway {
    constructor(
        private readonly io: Server,
        private readonly rpcRegistry: RpcRegistry
    ) {
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: true,
            mode,
            allowTools,
            decision,
            answers
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: false,
            decision
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'abort', { reason: 'User aborted via Telegram Bot' })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.sessionRpc(sessionId, 'switch', { to })
    }

    async requestSessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            model?: string | null
            collaborationMode?: CodexCollaborationMode
        }
    ): Promise<unknown> {
        return await this.sessionRpc(sessionId, 'set-session-config', config)
    }

    async killSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'killSession', {})
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode' = 'claude',
        model?: string,
        modelReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh',
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        sessionId?: string
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        try {
            const result = await this.machineRpc(
                machineId,
                'spawn-happy-session',
                {
                    type: 'spawn-in-directory',
                    directory,
                    sessionId,
                    agent,
                    model,
                    modelReasoningEffort,
                    yolo,
                    sessionType,
                    worktreeName,
                    resumeSessionId,
                    approvedNewDirectoryCreation: false
                }
            )
            if (result && typeof result === 'object') {
                const obj = result as Record<string, unknown>
                if (obj.type === 'success' && typeof obj.sessionId === 'string') {
                    return { type: 'success', sessionId: obj.sessionId }
                }
                if (obj.type === 'error' && typeof obj.errorMessage === 'string') {
                    return { type: 'error', message: obj.errorMessage }
                }
                if (obj.type === 'requestToApproveDirectoryCreation' && typeof obj.directory === 'string') {
                    return { type: 'error', message: `Directory creation requires approval: ${obj.directory}` }
                }
                if (typeof obj.error === 'string') {
                    return { type: 'error', message: obj.error }
                }
                if (obj.type !== 'success' && typeof obj.message === 'string') {
                    return { type: 'error', message: obj.message }
                }
            }
            const details = typeof result === 'string'
                ? result
                : (() => {
                    try {
                        return JSON.stringify(result)
                    } catch {
                        return String(result)
                    }
                })()
            return { type: 'error', message: `Unexpected spawn result: ${details}` }
        } catch (error) {
            return { type: 'error', message: error instanceof Error ? error.message : String(error) }
        }
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        const result = await this.machineRpc(machineId, 'path-exists', { paths }) as RpcPathExistsResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const existsValue = (result as RpcPathExistsResponse).exists
        if (!existsValue || typeof existsValue !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const exists: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(existsValue)) {
            exists[key] = value === true
        }
        return exists
    }

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-status', { cwd }) as RpcCommandResponse
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-numstat', options) as RpcCommandResponse
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-file', options) as RpcCommandResponse
    }

    async getGitBranches(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-branches', { cwd }) as RpcCommandResponse
    }

    async gitCheckout(sessionId: string, options: { cwd?: string; branch: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-checkout', options) as RpcCommandResponse
    }

    async gitStage(sessionId: string, options: { cwd?: string; filePath: string; stage: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-stage', options) as RpcCommandResponse
    }

    async gitCommit(sessionId: string, options: { cwd?: string; message: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-commit', options) as RpcCommandResponse
    }

    async gitFetch(sessionId: string, options: { cwd?: string; remote?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-fetch', options) as RpcCommandResponse
    }

    async gitPull(sessionId: string, options: { cwd?: string; remote?: string; branch?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-pull', options) as RpcCommandResponse
    }

    async gitRollbackFile(sessionId: string, options: { cwd?: string; filePath: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-rollback-file', options) as RpcCommandResponse
    }

    async gitCleanFile(sessionId: string, options: { cwd?: string; filePath: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-clean-file', options) as RpcCommandResponse
    }

    async gitBatchStage(sessionId: string, options: { cwd?: string; files: Array<{ filePath: string; stage: boolean }> }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-batch-stage', options) as RpcCommandResponse
    }

    async gitPush(sessionId: string, options: { cwd?: string; remote?: string; branch?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-push', options) as RpcCommandResponse
    }

    async gitLog(sessionId: string, options: { cwd?: string; limit?: number; skip?: number; branch?: string; keyword?: string; author?: string; hash?: string; since?: string; until?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-log', options) as RpcCommandResponse
    }

    async gitShowStat(sessionId: string, options: { cwd?: string; hash: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-show-stat', options) as RpcCommandResponse
    }

    async gitShowNumstat(sessionId: string, options: { cwd?: string; hash: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-show-numstat', options) as RpcCommandResponse
    }

    async gitShowFile(sessionId: string, options: { cwd?: string; hash: string; filePath: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-show-file', options) as RpcCommandResponse
    }

    async gitShowFileContent(sessionId: string, options: { cwd?: string; hash: string; filePath: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-show-file-content', options) as RpcCommandResponse
    }

    async gitCreateBranch(sessionId: string, options: { cwd?: string; name: string; from?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-create-branch', options) as RpcCommandResponse
    }

    async gitDeleteBranch(sessionId: string, options: { cwd?: string; name: string; force?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-delete-branch', options) as RpcCommandResponse
    }

    async gitRenameBranch(sessionId: string, options: { cwd?: string; oldName: string; newName: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-rename-branch', options) as RpcCommandResponse
    }

    async gitSetUpstream(sessionId: string, options: { cwd?: string; branch: string; upstream: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-set-upstream', options) as RpcCommandResponse
    }

    async gitRemoteList(sessionId: string, options: { cwd?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-remote-list', options) as RpcCommandResponse
    }

    async gitRemoteAdd(sessionId: string, options: { cwd?: string; name: string; url: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-remote-add', options) as RpcCommandResponse
    }

    async gitRemoteRemove(sessionId: string, options: { cwd?: string; name: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-remote-remove', options) as RpcCommandResponse
    }

    async gitRemoteSetUrl(sessionId: string, options: { cwd?: string; name: string; url: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-remote-set-url', options) as RpcCommandResponse
    }

    async gitStash(sessionId: string, options: { cwd?: string; message?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-stash', options) as RpcCommandResponse
    }

    async gitStashPop(sessionId: string, options: { cwd?: string; index?: number }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-stash-pop', options) as RpcCommandResponse
    }

    async gitStashList(sessionId: string, options: { cwd?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-stash-list', options) as RpcCommandResponse
    }

    async gitStashApply(sessionId: string, options: { cwd?: string; index?: number }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-stash-apply', options) as RpcCommandResponse
    }

    async gitStashDrop(sessionId: string, options: { cwd?: string; index?: number }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-stash-drop', options) as RpcCommandResponse
    }

    async gitMerge(sessionId: string, options: { cwd?: string; branch: string; squash?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-merge', options) as RpcCommandResponse
    }

    async gitDiscardChanges(sessionId: string, options: { cwd?: string; filePath: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-discard-changes', options) as RpcCommandResponse
    }

    async gitRemoteBranches(sessionId: string, options: { cwd?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-remote-branches', options) as RpcCommandResponse
    }

    async gitCherryPick(sessionId: string, options: { cwd?: string; hash: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-cherry-pick', options) as RpcCommandResponse
    }

    async gitCherryPickAbort(sessionId: string, options: { cwd?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-cherry-pick-abort', options) as RpcCommandResponse
    }

    async gitReset(sessionId: string, options: { cwd?: string; ref: string; mode: 'soft' | 'mixed' | 'hard' }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-reset', options) as RpcCommandResponse
    }

    async gitTagList(sessionId: string, options: { cwd?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-tag-list', options) as RpcCommandResponse
    }

    async gitTagCreate(sessionId: string, options: { cwd?: string; name: string; message?: string; ref?: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-tag-create', options) as RpcCommandResponse
    }

    async gitTagDelete(sessionId: string, options: { cwd?: string; name: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-tag-delete', options) as RpcCommandResponse
    }

    async gitAmend(sessionId: string, options: { cwd?: string; message: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-amend', options) as RpcCommandResponse
    }

    async gitRevert(sessionId: string, options: { cwd?: string; hash: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-revert', options) as RpcCommandResponse
    }

    async gitMergeDryRun(sessionId: string, options: { cwd?: string; branch: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-merge-dry-run', options) as RpcCommandResponse
    }

    async gitDiffBranches(sessionId: string, options: { cwd?: string; from: string; to: string }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-branches', options) as RpcCommandResponse
    }

    async readSessionFile(sessionId: string, path: string): Promise<RpcReadFileResponse> {
        return await this.sessionRpc(sessionId, 'readFile', { path }) as RpcReadFileResponse
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.sessionRpc(sessionId, 'listDirectory', { path }) as RpcListDirectoryResponse
    }

    async listMachineDirectory(machineId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.machineRpc(machineId, 'listMachineDirectory', { path }) as RpcListDirectoryResponse
    }

    async createMachineDirectory(machineId: string, parentPath: string, name: string): Promise<RpcCreateMachineDirectoryResponse> {
        return await this.machineRpc(machineId, 'createMachineDirectory', { parentPath, name }) as RpcCreateMachineDirectoryResponse
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.sessionRpc(sessionId, 'uploadFile', { sessionId, filename, content, mimeType }) as RpcUploadFileResponse
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.sessionRpc(sessionId, 'deleteUpload', { sessionId, path }) as RpcDeleteUploadResponse
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'ripgrep', { args, cwd }) as RpcCommandResponse
    }

    async listSlashCommands(sessionId: string, agent: string): Promise<{
        success: boolean
        commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSlashCommands', { agent }) as {
            success: boolean
            commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
            error?: string
        }
    }

    async listSkills(sessionId: string): Promise<{
        success: boolean
        skills?: Array<{ name: string; description?: string }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSkills', {}) as {
            success: boolean
            skills?: Array<{ name: string; description?: string }>
            error?: string
        }
    }

    private async sessionRpc(sessionId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${sessionId}:${method}`, params)
    }

    private async machineRpc(machineId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${machineId}:${method}`, params)
    }

    private async rpcCall(method: string, params: unknown): Promise<unknown> {
        const socketId = this.rpcRegistry.getSocketIdForMethod(method)
        if (!socketId) {
            throw new Error(`RPC handler not registered: ${method}`)
        }

        const socket = this.io.of('/cli').sockets.get(socketId)
        if (!socket) {
            throw new Error(`RPC socket disconnected: ${method}`)
        }

        const response = await socket.timeout(30_000).emitWithAck('rpc-request', {
            method,
            params: JSON.stringify(params)
        }) as unknown

        if (typeof response !== 'string') {
            return response
        }

        try {
            return JSON.parse(response) as unknown
        } catch {
            return response
        }
    }
}
