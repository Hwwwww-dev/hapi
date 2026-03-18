import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

const fileSearchSchema = z.object({
    query: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional()
})

const directorySchema = z.object({
    path: z.string().optional()
})

const filePathSchema = z.object({
    path: z.string().min(1)
})

const gitCheckoutSchema = z.object({ branch: z.string().min(1) })
const gitStageSchema = z.object({ filePath: z.string().min(1), stage: z.boolean() })
const gitCommitSchema = z.object({ message: z.string().min(1) })
const gitFetchSchema = z.object({ remote: z.string().optional() })
const gitPullSchema = z.object({ remote: z.string().optional(), branch: z.string().optional() })
const gitPushSchema = z.object({ remote: z.string().optional(), branch: z.string().optional() })
const gitLogSchema = z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), skip: z.coerce.number().int().min(0).optional() })
const gitCreateBranchSchema = z.object({ name: z.string().min(1), from: z.string().optional() })
const gitDeleteBranchSchema = z.object({ name: z.string().min(1), force: z.boolean().optional() })
const gitStashSchema = z.object({ message: z.string().optional() })
const gitStashPopSchema = z.object({ index: z.number().int().min(0).optional() })
const gitMergeSchema = z.object({ branch: z.string().min(1) })
const gitDiscardChangesSchema = z.object({ filePath: z.string().min(1) })

function parseBooleanParam(value: string | undefined): boolean | undefined {
    if (value === 'true') return true
    if (value === 'false') return false
    return undefined
}

async function runRpc<T>(fn: () => Promise<T>): Promise<T | { success: false; error: string }> {
    try {
        return await fn()
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.startsWith('RPC handler not registered:') || message.startsWith('RPC socket disconnected:')) {
            return { success: false, error: 'Session not connected' }
        }
        return { success: false, error: message }
    }
}

export function createGitRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions/:id/git-status', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const result = await runRpc(() => engine.getGitStatus(sessionResult.sessionId, sessionPath))
        return c.json(result)
    })

    app.get('/sessions/:id/git-diff-numstat', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const staged = parseBooleanParam(c.req.query('staged'))
        const result = await runRpc(() => engine.getGitDiffNumstat(sessionResult.sessionId, { cwd: sessionPath, staged }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-diff-file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = filePathSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid file path' }, 400)
        }

        const staged = parseBooleanParam(c.req.query('staged'))
        const result = await runRpc(() => engine.getGitDiffFile(sessionResult.sessionId, {
            cwd: sessionPath,
            filePath: parsed.data.path,
            staged
        }))
        return c.json(result)
    })

    app.get('/sessions/:id/file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = filePathSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid file path' }, 400)
        }

        const result = await runRpc(() => engine.readSessionFile(sessionResult.sessionId, parsed.data.path))
        return c.json(result)
    })

    app.get('/sessions/:id/files', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = fileSearchSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const query = parsed.data.query?.trim() ?? ''
        const limit = parsed.data.limit ?? 200
        const args = ['--files']
        if (query) {
            args.push('--iglob', `*${query}*`)
        }

        const result = await runRpc(() => engine.runRipgrep(sessionResult.sessionId, args, sessionPath))
        if (!result.success) {
            return c.json({ success: false, error: result.error ?? 'Failed to list files' })
        }

        const stdout = result.stdout ?? ''
        const files = stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, limit)
            .map((fullPath) => {
                const parts = fullPath.split('/')
                const fileName = parts[parts.length - 1] || fullPath
                const filePath = parts.slice(0, -1).join('/')
                return {
                    fileName,
                    filePath,
                    fullPath,
                    fileType: 'file' as const
                }
            })

        return c.json({ success: true, files })
    })

    app.get('/sessions/:id/directory', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = directorySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const path = parsed.data.path ?? ''
        const result = await runRpc(() => engine.listDirectory(sessionResult.sessionId, path))
        return c.json(result)
    })

    app.get('/sessions/:id/git-branches', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const result = await runRpc(() => engine.getGitBranches(sessionResult.sessionId, sessionPath))
        return c.json(result)
    })

    app.post('/sessions/:id/git-checkout', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitCheckoutSchema.safeParse(await c.req.json())
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitCheckout(sessionResult.sessionId, { cwd: sessionPath, branch: body.data.branch }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-stage', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitStageSchema.safeParse(await c.req.json())
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitStage(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-commit', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitCommitSchema.safeParse(await c.req.json())
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitCommit(sessionResult.sessionId, { cwd: sessionPath, message: body.data.message }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-fetch', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitFetchSchema.safeParse(await c.req.json().catch(() => ({})))
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitFetch(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-pull', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitPullSchema.safeParse(await c.req.json().catch(() => ({})))
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitPull(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-rollback-file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = z.object({ filePath: z.string().min(1) }).safeParse(await c.req.json())
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitRollbackFile(sessionResult.sessionId, { cwd: sessionPath, filePath: body.data.filePath }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-push', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitPushSchema.safeParse(await c.req.json().catch(() => ({})))
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitPush(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-log', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const parsed = gitLogSchema.safeParse(c.req.query())
        if (!parsed.success) return c.json({ error: 'Invalid query' }, 400)
        const result = await runRpc(() => engine.gitLog(sessionResult.sessionId, { cwd: sessionPath, limit: parsed.data.limit, skip: parsed.data.skip }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-show-stat', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const hash = c.req.query('hash')
        if (!hash) return c.json({ error: 'hash is required' }, 400)
        const result = await runRpc(() => engine.gitShowStat(sessionResult.sessionId, { cwd: sessionPath, hash }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-show-file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const hash = c.req.query('hash')
        const filePath = c.req.query('filePath')
        if (!hash) return c.json({ error: 'hash is required' }, 400)
        if (!filePath) return c.json({ error: 'filePath is required' }, 400)
        const result = await runRpc(() => engine.gitShowFile(sessionResult.sessionId, { cwd: sessionPath, hash, filePath }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-show-file-content', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const hash = c.req.query('hash')
        const filePath = c.req.query('filePath')
        if (!hash) return c.json({ error: 'hash is required' }, 400)
        if (!filePath) return c.json({ error: 'filePath is required' }, 400)
        const result = await runRpc(() => engine.gitShowFileContent(sessionResult.sessionId, { cwd: sessionPath, hash, filePath }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-create-branch', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitCreateBranchSchema.safeParse(await c.req.json())
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitCreateBranch(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-delete-branch', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitDeleteBranchSchema.safeParse(await c.req.json())
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitDeleteBranch(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-stash', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitStashSchema.safeParse(await c.req.json().catch(() => ({})))
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitStash(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-stash-pop', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitStashPopSchema.safeParse(await c.req.json().catch(() => ({})))
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitStashPop(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-stash-list', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const result = await runRpc(() => engine.gitStashList(sessionResult.sessionId, { cwd: sessionPath }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-merge', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitMergeSchema.safeParse(await c.req.json())
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitMerge(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
        return c.json(result)
    })

    app.post('/sessions/:id/git-discard-changes', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const body = gitDiscardChangesSchema.safeParse(await c.req.json())
        if (!body.success) return c.json({ error: 'Invalid request' }, 400)
        const result = await runRpc(() => engine.gitDiscardChanges(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-remote-branches', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
        const result = await runRpc(() => engine.gitRemoteBranches(sessionResult.sessionId, { cwd: sessionPath }))
        return c.json(result)
    })

    return app
}
