import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { RpcHandlerManager } from '../../../api/rpc/RpcHandlerManager'
import { registerGitHandlers } from './git'

const execFileAsync = promisify(execFile)

async function createTempDir(prefix: string): Promise<string> {
    const base = tmpdir()
    const path = join(base, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

async function initGitRepo(dir: string): Promise<void> {
    await execFileAsync('git', ['init'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'README.md'), '# test')
    await execFileAsync('git', ['add', '.'], { cwd: dir })
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir })
}

describe('git RPC handlers', () => {
    let rootDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }
        rootDir = await createTempDir('hapi-git-handler')
        await initGitRepo(rootDir)
        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, rootDir)
    })

    describe('git-branches', () => {
        it('returns current branch', async () => {
            const res = await rpc.handleRequest({
                method: 'session-test:git-branches',
                params: JSON.stringify({})
            })
            const parsed = JSON.parse(res) as { success: boolean; stdout?: string }
            expect(parsed.success).toBe(true)
            expect(parsed.stdout).toMatch(/main|master/)
        })

        it('returns error for invalid cwd', async () => {
            const res = await rpc.handleRequest({
                method: 'session-test:git-branches',
                params: JSON.stringify({ cwd: '/nonexistent/path' })
            })
            const parsed = JSON.parse(res) as { success: boolean }
            expect(parsed.success).toBe(false)
        })
    })

    describe('git-checkout', () => {
        it('checks out an existing branch', async () => {
            // 创建 feature 分支后切回默认分支，再通过 RPC 切换过去
            await execFileAsync('git', ['checkout', '-b', 'feature-test'], { cwd: rootDir })
            const defaultBranch = (await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD~0'], { cwd: rootDir })).stdout.trim()
            // 切回 main/master
            const mainBranch = (await execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd: rootDir }))
                .stdout.split('\n').map(b => b.trim()).find(b => b && b !== 'feature-test') ?? 'main'
            await execFileAsync('git', ['checkout', mainBranch], { cwd: rootDir })

            const res = await rpc.handleRequest({
                method: 'session-test:git-checkout',
                params: JSON.stringify({ branch: 'feature-test' })
            })
            const parsed = JSON.parse(res) as { success: boolean }
            expect(parsed.success).toBe(true)

            const current = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootDir })
            expect(current.stdout.trim()).toBe('feature-test')
        })

        it('returns error when branch is missing', async () => {
            const res = await rpc.handleRequest({
                method: 'session-test:git-checkout',
                params: JSON.stringify({})
            })
            const parsed = JSON.parse(res) as { success: boolean; error?: string }
            expect(parsed.success).toBe(false)
            expect(parsed.error).toMatch(/branch is required/)
        })

        it('returns error for nonexistent branch', async () => {
            const res = await rpc.handleRequest({
                method: 'session-test:git-checkout',
                params: JSON.stringify({ branch: 'nonexistent-branch-xyz' })
            })
            const parsed = JSON.parse(res) as { success: boolean }
            expect(parsed.success).toBe(false)
        })
    })

    describe('git-stage', () => {
        it('stages a file', async () => {
            await writeFile(join(rootDir, 'new-file.txt'), 'hello')
            const res = await rpc.handleRequest({
                method: 'session-test:git-stage',
                params: JSON.stringify({ filePath: 'new-file.txt', stage: true })
            })
            const parsed = JSON.parse(res) as { success: boolean }
            expect(parsed.success).toBe(true)

            const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: rootDir })
            expect(status.stdout).toContain('A  new-file.txt')
        })

        it('unstages a staged file', async () => {
            await writeFile(join(rootDir, 'staged.txt'), 'hello')
            await execFileAsync('git', ['add', 'staged.txt'], { cwd: rootDir })

            const res = await rpc.handleRequest({
                method: 'session-test:git-stage',
                params: JSON.stringify({ filePath: 'staged.txt', stage: false })
            })
            const parsed = JSON.parse(res) as { success: boolean }
            expect(parsed.success).toBe(true)

            const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: rootDir })
            expect(status.stdout).not.toContain('A  staged.txt')
        })

        it('rejects path traversal', async () => {
            const res = await rpc.handleRequest({
                method: 'session-test:git-stage',
                params: JSON.stringify({ filePath: '../outside.txt', stage: true })
            })
            const parsed = JSON.parse(res) as { success: boolean }
            expect(parsed.success).toBe(false)
        })
    })

    describe('git-commit', () => {
        it('commits staged changes', async () => {
            await writeFile(join(rootDir, 'commit-test.txt'), 'hello')
            await execFileAsync('git', ['add', 'commit-test.txt'], { cwd: rootDir })

            const res = await rpc.handleRequest({
                method: 'session-test:git-commit',
                params: JSON.stringify({ message: 'test commit message' })
            })
            const parsed = JSON.parse(res) as { success: boolean }
            expect(parsed.success).toBe(true)

            const log = await execFileAsync('git', ['log', '--oneline', '-1'], { cwd: rootDir })
            expect(log.stdout).toContain('test commit message')
        })

        it('returns error for empty message', async () => {
            const res = await rpc.handleRequest({
                method: 'session-test:git-commit',
                params: JSON.stringify({ message: '   ' })
            })
            const parsed = JSON.parse(res) as { success: boolean; error?: string }
            expect(parsed.success).toBe(false)
            expect(parsed.error).toMatch(/commit message is required/)
        })

        it('returns error when nothing to commit', async () => {
            const res = await rpc.handleRequest({
                method: 'session-test:git-commit',
                params: JSON.stringify({ message: 'empty commit' })
            })
            const parsed = JSON.parse(res) as { success: boolean }
            expect(parsed.success).toBe(false)
        })
    })
})
