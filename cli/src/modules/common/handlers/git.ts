import { execFile, type ExecFileOptions } from 'child_process'
import { promisify } from 'util'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { rpcError } from '../rpcResponses'

const execFileAsync = promisify(execFile)

// Git operation queue - serializes commands per working directory
const gitQueues = new Map<string, Promise<unknown>>()

async function queuedGitCommand(
    args: string[],
    cwd: string,
    timeout?: number
): Promise<GitCommandResponse> {
    const prev = gitQueues.get(cwd) ?? Promise.resolve()
    const next = prev.then(
        () => runGitCommand(args, cwd, timeout),
        () => runGitCommand(args, cwd, timeout)
    )
    gitQueues.set(cwd, next.catch(() => {}))
    return next
}

interface GitStatusRequest {
    cwd?: string
    timeout?: number
}

interface GitDiffNumstatRequest {
    cwd?: string
    staged?: boolean
    timeout?: number
}

interface GitDiffFileRequest {
    cwd?: string
    filePath: string
    staged?: boolean
    timeout?: number
}

interface GitCommandResponse {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

function resolveCwd(requestedCwd: string | undefined, workingDirectory: string): { cwd: string; error?: string } {
    const cwd = requestedCwd ?? workingDirectory
    const validation = validatePath(cwd, workingDirectory)
    if (!validation.valid) {
        return { cwd, error: validation.error ?? 'Invalid working directory' }
    }
    return { cwd }
}

function validateFilePath(filePath: string, workingDirectory: string): string | null {
    const validation = validatePath(filePath, workingDirectory)
    if (!validation.valid) {
        return validation.error ?? 'Invalid file path'
    }
    return null
}

async function runGitCommand(
    args: string[],
    cwd: string,
    timeout?: number
): Promise<GitCommandResponse> {
    try {
        const options: ExecFileOptions = {
            cwd,
            timeout: timeout ?? 10_000
        }
        const { stdout, stderr } = await execFileAsync('git', args, options)
        return {
            success: true,
            stdout: stdout ? stdout.toString() : '',
            stderr: stderr ? stderr.toString() : '',
            exitCode: 0
        }
    } catch (error) {
        const execError = error as NodeJS.ErrnoException & {
            stdout?: string
            stderr?: string
            code?: number | string
            killed?: boolean
        }

        if (execError.code === 'ETIMEDOUT' || execError.killed) {
            return rpcError('Command timed out', {
                stdout: execError.stdout ? execError.stdout.toString() : '',
                stderr: execError.stderr ? execError.stderr.toString() : '',
                exitCode: typeof execError.code === 'number' ? execError.code : -1
            })
        }

        return rpcError(execError.message || 'Command failed', {
            stdout: execError.stdout ? execError.stdout.toString() : '',
            stderr: execError.stderr ? execError.stderr.toString() : execError.message || 'Command failed',
            exitCode: typeof execError.code === 'number' ? execError.code : 1
        })
    }
}

export function registerGitHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<GitStatusRequest, GitCommandResponse>('git-status', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        return await queuedGitCommand(
            ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
            resolved.cwd,
            data.timeout
        )
    })

    rpcHandlerManager.registerHandler<GitDiffNumstatRequest, GitCommandResponse>('git-diff-numstat', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const args = data.staged
            ? ['diff', '--cached', '--numstat']
            : ['diff', '--numstat']
        return await queuedGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<GitDiffFileRequest, GitCommandResponse>('git-diff-file', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const fileError = validateFilePath(data.filePath, workingDirectory)
        if (fileError) {
            return rpcError(fileError)
        }

        const args = data.staged
            ? ['diff', '--cached', '--no-ext-diff', '--', data.filePath]
            : ['diff', '--no-ext-diff', '--', data.filePath]
        return await queuedGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; timeout?: number }, GitCommandResponse>('git-branches', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        return await queuedGitCommand(['branch', '--format=%(refname:strip=2)'], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; branch: string; timeout?: number }, GitCommandResponse>('git-checkout', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.branch || typeof data.branch !== 'string') return rpcError('branch is required')
        return await queuedGitCommand(['checkout', data.branch], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; filePath: string; stage: boolean; timeout?: number }, GitCommandResponse>('git-stage', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        const fileError = validateFilePath(data.filePath, workingDirectory)
        if (fileError) return rpcError(fileError)
        const args = data.stage
            ? ['add', data.filePath]
            : ['restore', '--staged', data.filePath]
        return await queuedGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; message: string; timeout?: number }, GitCommandResponse>('git-commit', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.message?.trim()) return rpcError('commit message is required')
        return await queuedGitCommand(['commit', '-m', data.message], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; remote?: string; timeout?: number }, GitCommandResponse>('git-fetch', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        const args = data.remote ? ['fetch', data.remote] : ['fetch']
        return await queuedGitCommand(args, resolved.cwd, data.timeout ?? 30_000)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; remote?: string; branch?: string; timeout?: number }, GitCommandResponse>('git-pull', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        const args = ['pull']
        if (data.remote) args.push(data.remote)
        if (data.branch) args.push(data.branch)
        return await queuedGitCommand(args, resolved.cwd, data.timeout ?? 60_000)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; filePath: string; timeout?: number }, GitCommandResponse>('git-rollback-file', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        const fileError = validateFilePath(data.filePath, workingDirectory)
        if (fileError) return rpcError(fileError)
        return await queuedGitCommand(['checkout', 'HEAD', '--', data.filePath], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; remote?: string; branch?: string; timeout?: number }, GitCommandResponse>('git-push', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        const args = ['push']
        if (data.remote) args.push(data.remote)
        if (data.branch) args.push(data.branch)
        return await queuedGitCommand(args, resolved.cwd, data.timeout ?? 60_000)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; limit?: number; skip?: number; timeout?: number }, GitCommandResponse>('git-log', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        const limit = Math.min(Math.max(data.limit ?? 50, 1), 500)
        const args = ['log', '--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s', '-n', String(limit)]
        if (data.skip && data.skip > 0) args.push('--skip=' + String(data.skip))
        return await queuedGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; name: string; from?: string; timeout?: number }, GitCommandResponse>('git-create-branch', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.name || typeof data.name !== 'string') return rpcError('branch name is required')
        const args = ['checkout', '-b', data.name]
        if (data.from) args.push(data.from)
        return await queuedGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; name: string; force?: boolean; timeout?: number }, GitCommandResponse>('git-delete-branch', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.name || typeof data.name !== 'string') return rpcError('branch name is required')
        return await queuedGitCommand(['branch', data.force ? '-D' : '-d', data.name], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; message?: string; timeout?: number }, GitCommandResponse>('git-stash', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        const args = data.message ? ['stash', 'push', '-m', data.message] : ['stash']
        return await queuedGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; index?: number; timeout?: number }, GitCommandResponse>('git-stash-pop', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        const args = data.index !== undefined ? ['stash', 'pop', String(data.index)] : ['stash', 'pop']
        return await queuedGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; timeout?: number }, GitCommandResponse>('git-stash-list', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        return await queuedGitCommand(['stash', 'list'], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; branch: string; timeout?: number }, GitCommandResponse>('git-merge', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.branch || typeof data.branch !== 'string') return rpcError('branch name is required')
        return await queuedGitCommand(['merge', data.branch], resolved.cwd, data.timeout ?? 30_000)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; filePath: string; timeout?: number }, GitCommandResponse>('git-discard-changes', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        const fileError = validateFilePath(data.filePath, workingDirectory)
        if (fileError) return rpcError(fileError)
        return await queuedGitCommand(['checkout', '--', data.filePath], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; timeout?: number }, GitCommandResponse>('git-remote-branches', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        return await queuedGitCommand(['branch', '-r', '--format=%(refname:strip=2)'], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; hash: string; timeout?: number }, GitCommandResponse>('git-show-stat', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.hash || typeof data.hash !== 'string') return rpcError('commit hash is required')
        return await queuedGitCommand(['diff-tree', '--no-commit-id', '-r', '-m', '--name-status', data.hash], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; hash: string; filePath: string; timeout?: number }, GitCommandResponse>('git-show-file', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.hash || typeof data.hash !== 'string') return rpcError('commit hash is required')
        if (!data.filePath || typeof data.filePath !== 'string') return rpcError('file path is required')
        return await queuedGitCommand(['diff-tree', '--no-commit-id', '-r', '-p', '-m', data.hash, '--', data.filePath], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; hash: string; filePath: string; timeout?: number }, GitCommandResponse>('git-show-file-content', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.hash || typeof data.hash !== 'string') return rpcError('commit hash is required')
        if (!data.filePath || typeof data.filePath !== 'string') return rpcError('file path is required')
        return await queuedGitCommand(['show', `${data.hash}:${data.filePath}`], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; filePath: string; timeout?: number }, GitCommandResponse>('git-clean-file', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        const fileError = validateFilePath(data.filePath, workingDirectory)
        if (fileError) return rpcError(fileError)
        return await queuedGitCommand(['clean', '-f', '--', data.filePath], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; files: Array<{ filePath: string; stage: boolean }>; timeout?: number }, GitCommandResponse>('git-batch-stage', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!Array.isArray(data.files) || data.files.length === 0) return rpcError('files array is required')

        const toStage = data.files.filter(f => f.stage).map(f => f.filePath)
        const toUnstage = data.files.filter(f => !f.stage).map(f => f.filePath)

        if (toStage.length > 0) {
            for (const fp of toStage) {
                const fileError = validateFilePath(fp, workingDirectory)
                if (fileError) return rpcError(fileError)
            }
            const result = await queuedGitCommand(['add', '--', ...toStage], resolved.cwd, data.timeout)
            if (!result.success) return result
        }

        if (toUnstage.length > 0) {
            for (const fp of toUnstage) {
                const fileError = validateFilePath(fp, workingDirectory)
                if (fileError) return rpcError(fileError)
            }
            const result = await queuedGitCommand(['restore', '--staged', '--', ...toUnstage], resolved.cwd, data.timeout)
            if (!result.success) return result
        }

        return { success: true, stdout: '', stderr: '', exitCode: 0 }
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; oldName: string; newName: string; timeout?: number }, GitCommandResponse>('git-rename-branch', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.oldName || typeof data.oldName !== 'string') return rpcError('old branch name is required')
        if (!data.newName || typeof data.newName !== 'string') return rpcError('new branch name is required')
        return await queuedGitCommand(['branch', '-m', data.oldName, data.newName], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; branch: string; upstream: string; timeout?: number }, GitCommandResponse>('git-set-upstream', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.branch || typeof data.branch !== 'string') return rpcError('branch name is required')
        if (!data.upstream || typeof data.upstream !== 'string') return rpcError('upstream is required')
        return await queuedGitCommand(['branch', `--set-upstream-to=${data.upstream}`, data.branch], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; timeout?: number }, GitCommandResponse>('git-remote-list', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        return await queuedGitCommand(['remote', '-v'], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; name: string; url: string; timeout?: number }, GitCommandResponse>('git-remote-add', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.name || typeof data.name !== 'string') return rpcError('remote name is required')
        if (!data.url || typeof data.url !== 'string') return rpcError('remote url is required')
        return await queuedGitCommand(['remote', 'add', data.name, data.url], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; name: string; timeout?: number }, GitCommandResponse>('git-remote-remove', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.name || typeof data.name !== 'string') return rpcError('remote name is required')
        return await queuedGitCommand(['remote', 'remove', data.name], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; name: string; url: string; timeout?: number }, GitCommandResponse>('git-remote-set-url', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.name || typeof data.name !== 'string') return rpcError('remote name is required')
        if (!data.url || typeof data.url !== 'string') return rpcError('remote url is required')
        return await queuedGitCommand(['remote', 'set-url', data.name, data.url], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; hash: string; timeout?: number }, GitCommandResponse>('git-cherry-pick', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.hash || typeof data.hash !== 'string') return rpcError('commit hash is required')
        return await queuedGitCommand(['cherry-pick', data.hash], resolved.cwd, data.timeout ?? 30_000)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; timeout?: number }, GitCommandResponse>('git-cherry-pick-abort', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        return await queuedGitCommand(['cherry-pick', '--abort'], resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<{ cwd?: string; ref: string; mode: 'soft' | 'mixed' | 'hard'; timeout?: number }, GitCommandResponse>('git-reset', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (!data.ref || typeof data.ref !== 'string') return rpcError('ref is required')
        const validModes = ['soft', 'mixed', 'hard']
        if (!validModes.includes(data.mode)) return rpcError('mode must be soft, mixed, or hard')
        return await queuedGitCommand(['reset', `--${data.mode}`, data.ref], resolved.cwd, data.timeout)
    })

}
