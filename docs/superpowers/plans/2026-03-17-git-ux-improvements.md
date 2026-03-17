# Git UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Files 页面添加分支切换、目录树展开记忆、文件提交三个功能。

**Architecture:** 后端新增 4 个 git RPC handler（CLI 层）和对应 Hub 路由；前端新增 BranchSwitcher、CommitDrawer 两个组件，DirectoryTree 改为受控展开状态，files.tsx 串联所有功能。

**Tech Stack:** TypeScript, React, TanStack Router, Bun, Vitest

---

## Chunk 1: 后端 RPC — git-branches & git-checkout

### Task 1: CLI 新增 git-branches 和 git-checkout handler

**Files:**
- Modify: `cli/src/modules/common/handlers/git.ts`

- [ ] **Step 1: 在 `registerGitHandlers` 末尾追加两个 handler**

```ts
interface GitBranchesRequest {
    cwd?: string
}

interface GitCheckoutRequest {
    cwd?: string
    branch: string
}

// 在 registerGitHandlers 函数末尾追加：
rpcHandlerManager.registerHandler<GitBranchesRequest, GitCommandResponse>('git-branches', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    return await runGitCommand(['branch', '--format=%(refname:short)'], resolved.cwd, data.timeout)
})

rpcHandlerManager.registerHandler<GitCheckoutRequest, GitCommandResponse>('git-checkout', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    if (!data.branch || typeof data.branch !== 'string') return rpcError('branch is required')
    return await runGitCommand(['checkout', data.branch], resolved.cwd, data.timeout)
})
```

- [ ] **Step 2: 运行 CLI 测试确认无报错**

```bash
cd /home/hwwwww/Project/hapi && bun run test:cli
```

---

### Task 2: CLI 新增 git-stage 和 git-commit handler

**Files:**
- Modify: `cli/src/modules/common/handlers/git.ts`

- [ ] **Step 1: 追加两个 handler**

```ts
interface GitStageRequest {
    cwd?: string
    filePath: string
    stage: boolean
}

interface GitCommitRequest {
    cwd?: string
    message: string
}

rpcHandlerManager.registerHandler<GitStageRequest, GitCommandResponse>('git-stage', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    const fileError = validateFilePath(data.filePath, workingDirectory)
    if (fileError) return rpcError(fileError)
    const args = data.stage
        ? ['add', data.filePath]
        : ['restore', '--staged', data.filePath]
    return await runGitCommand(args, resolved.cwd, data.timeout)
})

rpcHandlerManager.registerHandler<GitCommitRequest, GitCommandResponse>('git-commit', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    if (!data.message?.trim()) return rpcError('commit message is required')
    return await runGitCommand(['commit', '-m', data.message], resolved.cwd, data.timeout)
})
```

- [ ] **Step 2: 运行测试**

```bash
cd /home/hwwwww/Project/hapi && bun run test:cli
```

- [ ] **Step 3: Commit**

```bash
git add cli/src/modules/common/handlers/git.ts
git commit -m "feat(cli): add git-branches, git-checkout, git-stage, git-commit RPC handlers"
```

---

### Task 3: Hub rpcGateway 新增 4 个方法

**Files:**
- Modify: `hub/src/sync/rpcGateway.ts`

- [ ] **Step 1: 在 `getGitDiffFile` 方法后追加**

```ts
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
```

---

### Task 4: Hub syncEngine 暴露 4 个方法

**Files:**
- Modify: `hub/src/sync/syncEngine.ts`

- [ ] **Step 1: 在 `getGitDiffFile` 方法后追加**

```ts
async getGitBranches(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
    return await this.rpcGateway.getGitBranches(sessionId, cwd)
}

async gitCheckout(sessionId: string, options: { cwd?: string; branch: string }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitCheckout(sessionId, options)
}

async gitStage(sessionId: string, options: { cwd?: string; filePath: string; stage: boolean }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitStage(sessionId, options)
}

async gitCommit(sessionId: string, options: { cwd?: string; message: string }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitCommit(sessionId, options)
}
```

---

### Task 5: Hub 新增 4 个 HTTP 路由

**Files:**
- Modify: `hub/src/web/routes/git.ts`

- [ ] **Step 1: 在文件顶部 schema 区域追加**

```ts
const gitCheckoutSchema = z.object({ branch: z.string().min(1) })
const gitStageSchema = z.object({ filePath: z.string().min(1), stage: z.boolean() })
const gitCommitSchema = z.object({ message: z.string().min(1) })
```

- [ ] **Step 2: 在 `createGitRoutes` 函数末尾（`return app` 前）追加 4 个路由**

```ts
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
```

- [ ] **Step 3: 运行 Hub 测试**

```bash
cd /home/hwwwww/Project/hapi && bun run test:hub
```

- [ ] **Step 4: Commit**

```bash
git add hub/src/sync/rpcGateway.ts hub/src/sync/syncEngine.ts hub/src/web/routes/git.ts
git commit -m "feat(hub): expose git-branches, git-checkout, git-stage, git-commit via HTTP"
```

---

## Chunk 2: 前端 API Client + 类型

### Task 6: 前端 API client 新增 4 个方法

**Files:**
- Modify: `web/src/api/client.ts`

- [ ] **Step 1: 在 `getGitDiffFile` 方法后追加**

```ts
async getGitBranches(sessionId: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-branches`)
}

async gitCheckout(sessionId: string, branch: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch })
    })
}

async gitStage(sessionId: string, filePath: string, stage: boolean): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, stage })
    })
}

async gitCommit(sessionId: string, message: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
    })
}
```

- [ ] **Step 2: 运行 web 类型检查**

```bash
cd /home/hwwwww/Project/hapi/web && bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add web/src/api/client.ts
git commit -m "feat(web): add gitBranches, gitCheckout, gitStage, gitCommit API client methods"
```

---

## Chunk 3: 目录树展开记忆

### Task 7: Router schema 新增 expanded 参数

**Files:**
- Modify: `web/src/router.tsx`

- [ ] **Step 1: 找到 files 路由的 search schema，添加 `expanded` 字段**

在 files 路由的 `validateSearch` 或 search schema 中添加：
```ts
expanded: z.string().optional()
```

---

### Task 8: DirectoryTree 改为受控展开状态

**Files:**
- Modify: `web/src/components/SessionFiles/DirectoryTree.tsx`

- [ ] **Step 1: 查看当前 DirectoryTree 的 props 和 expanded state**

当前 `expanded` 用 `useState` 管理，改为受控：

```ts
// 修改 props 类型，新增：
expandedPaths?: string[]
onExpandedChange?: (paths: string[]) => void

// 移除内部 useState<Set<string>>，改为：
const expandedSet = useMemo(
    () => new Set(expandedPaths ?? ['']),
    [expandedPaths]
)

// toggle 时调用 onExpandedChange：
const handleToggle = (path: string) => {
    const next = new Set(expandedSet)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    onExpandedChange?.(Array.from(next))
}
```

- [ ] **Step 2: 保持向后兼容** — 当 `expandedPaths` 未传入时，使用内部 state fallback（或默认 `['']`）

---

### Task 9: FilesPage 读写 URL expanded 参数

**Files:**
- Modify: `web/src/routes/sessions/files.tsx`

- [ ] **Step 1: 从 URL search 读取 expanded**

```ts
const search = useSearch({ from: '/sessions/$sessionId/files' })
const expandedPaths = useMemo(
    () => search.expanded ? search.expanded.split(',').filter(Boolean) : [''],
    [search.expanded]
)
```

- [ ] **Step 2: 写回 URL（replace 模式，不污染历史）**

```ts
const handleExpandedChange = useCallback((paths: string[]) => {
    navigate({
        search: (prev) => ({ ...prev, expanded: paths.join(',') || undefined }),
        replace: true
    })
}, [navigate])
```

- [ ] **Step 3: 传给 DirectoryTree**

```tsx
<DirectoryTree
    expandedPaths={expandedPaths}
    onExpandedChange={handleExpandedChange}
    ...
/>
```

- [ ] **Step 4: tab 切换时保留 expanded 参数**

确保 `handleTabChange` 使用 `(prev) => ({ ...prev, tab: ... })` 形式。

- [ ] **Step 5: 运行 web 测试**

```bash
cd /home/hwwwww/Project/hapi/web && bun run test
```

- [ ] **Step 6: Commit**

```bash
git add web/src/router.tsx web/src/components/SessionFiles/DirectoryTree.tsx web/src/routes/sessions/files.tsx
git commit -m "feat(web): persist directory tree expanded state in URL search params"
```

---

## Chunk 4: 分支切换组件

### Task 10: 新建 BranchSwitcher 组件

**Files:**
- Create: `web/src/components/SessionFiles/BranchSwitcher.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { GitStatus } from '@/lib/gitParsers'

interface Props {
    api: ApiClient
    sessionId: string
    currentBranch: string
    hasBlockingChanges: boolean
    onSwitched: () => void
}

export function BranchSwitcher({ api, sessionId, currentBranch, hasBlockingChanges, onSwitched }: Props) {
    const [open, setOpen] = useState(false)
    const [branches, setBranches] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [switching, setSwitching] = useState(false)

    const handleOpen = async () => {
        setOpen(true)
        setLoading(true)
        setError(null)
        const res = await api.getGitBranches(sessionId)
        setLoading(false)
        if (res.success && res.stdout) {
            setBranches(res.stdout.split('\n').map(b => b.trim()).filter(Boolean))
        } else {
            setError(res.error ?? 'Failed to load branches')
        }
    }

    const handleSelect = async (branch: string) => {
        if (branch === currentBranch) { setOpen(false); return }
        if (hasBlockingChanges) {
            setError('You have uncommitted changes. Please commit or stash them before switching branches.')
            return
        }
        setSwitching(true)
        setError(null)
        const res = await api.gitCheckout(sessionId, branch)
        setSwitching(false)
        if (res.success) {
            setOpen(false)
            onSwitched()
        } else {
            setError(res.stderr ?? res.error ?? 'Checkout failed')
        }
    }

    return (
        <div className="relative">
            <button onClick={handleOpen} className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted">
                switch
            </button>
            {open && (
                <div className="absolute top-6 left-0 z-50 bg-background border border-border rounded shadow-md min-w-40 max-h-60 overflow-y-auto">
                    <div className="flex items-center justify-between px-2 py-1 border-b border-border">
                        <span className="text-xs font-medium">Branches</span>
                        <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground">✕</button>
                    </div>
                    {error && <div className="px-2 py-1 text-xs text-destructive">{error}</div>}
                    {loading && <div className="px-2 py-1 text-xs text-muted-foreground">Loading...</div>}
                    {!loading && branches.map(b => (
                        <button
                            key={b}
                            onClick={() => handleSelect(b)}
                            disabled={switching}
                            className={`w-full text-left px-2 py-1 text-xs hover:bg-muted ${b === currentBranch ? 'font-bold' : ''}`}
                        >
                            {b === currentBranch ? `✓ ${b}` : b}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
```

---

### Task 11: 在 files.tsx 集成 BranchSwitcher

**Files:**
- Modify: `web/src/routes/sessions/files.tsx`

- [ ] **Step 1: 计算 hasBlockingChanges**

```ts
const hasBlockingChanges = (gitStatus?.totalStaged ?? 0) > 0
    || (gitStatus?.unstagedFiles ?? []).some(f => f.status !== 'untracked')
```

- [ ] **Step 2: 在分支名旁边渲染 BranchSwitcher**

```tsx
import { BranchSwitcher } from '@/components/SessionFiles/BranchSwitcher'

// 在显示 branch 的地方旁边：
<BranchSwitcher
    api={api}
    sessionId={sessionId}
    currentBranch={gitStatus.branch}
    hasBlockingChanges={hasBlockingChanges}
    onSwitched={refetchGit}
/>
```

- [ ] **Step 3: 运行 web 测试**

```bash
cd /home/hwwwww/Project/hapi/web && bun run test
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/SessionFiles/BranchSwitcher.tsx web/src/routes/sessions/files.tsx
git commit -m "feat(web): add BranchSwitcher component with conflict guard"
```

---

## Chunk 5: 文件提交组件

### Task 12: 新建 CommitDrawer 组件

**Files:**
- Create: `web/src/components/SessionFiles/CommitDrawer.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { GitStatus } from '@/lib/gitParsers'

interface Props {
    api: ApiClient
    sessionId: string
    gitStatus: GitStatus
    onCommitted: () => void
    onStaged: () => void
    onClose: () => void
}

export function CommitDrawer({ api, sessionId, gitStatus, onCommitted, onStaged, onClose }: Props) {
    const [message, setMessage] = useState('')
    const [isPending, setIsPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const allFiles = [
        ...gitStatus.stagedFiles.map(f => ({ ...f, isStaged: true })),
        ...gitStatus.unstagedFiles.map(f => ({ ...f, isStaged: false }))
    ]

    const handleToggle = async (filePath: string, currentlyStaged: boolean) => {
        const res = await api.gitStage(sessionId, filePath, !currentlyStaged)
        if (res.success) {
            onStaged()
        } else {
            setError(res.stderr ?? res.error ?? 'Stage failed')
        }
    }

    const handleCommit = async () => {
        if (!message.trim() || gitStatus.stagedFiles.length === 0) return
        setIsPending(true)
        setError(null)
        const res = await api.gitCommit(sessionId, message.trim())
        setIsPending(false)
        if (res.success) {
            onCommitted()
            onClose()
        } else {
            setError(res.stderr ?? res.error ?? 'Commit failed')
        }
    }

    return (
        <div className="border-t border-border bg-background p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Commit changes</span>
                <button onClick={onClose} className="text-xs text-muted-foreground">✕</button>
            </div>
            <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
                {allFiles.map(f => (
                    <label key={f.path} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted px-1 rounded">
                        <input
                            type="checkbox"
                            checked={f.isStaged}
                            onChange={() => handleToggle(f.path, f.isStaged)}
                        />
                        <span className={f.isStaged ? '' : 'text-muted-foreground'}>{f.path}</span>
                    </label>
                ))}
            </div>
            <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Commit message..."
                className="text-xs border border-border rounded p-1.5 resize-none h-16 bg-background"
            />
            {error && <div className="text-xs text-destructive">{error}</div>}
            <button
                onClick={handleCommit}
                disabled={isPending || !message.trim() || gitStatus.stagedFiles.length === 0}
                className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
            >
                {isPending ? 'Committing...' : `Commit ${gitStatus.stagedFiles.length > 0 ? `(${gitStatus.stagedFiles.length})` : ''}`}
            </button>
        </div>
    )
}
```

---

### Task 13: 在 files.tsx 集成 CommitDrawer

**Files:**
- Modify: `web/src/routes/sessions/files.tsx`

- [ ] **Step 1: 添加 commitOpen state**

```ts
const [commitOpen, setCommitOpen] = useState(false)
```

- [ ] **Step 2: 在 Changes tab 的 git status bar 添加 Commit 按钮**

```tsx
<button
    onClick={() => setCommitOpen(true)}
    className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted"
>
    Commit
</button>
```

- [ ] **Step 3: 渲染 CommitDrawer**

```tsx
import { CommitDrawer } from '@/components/SessionFiles/CommitDrawer'

{commitOpen && gitStatus && (
    <CommitDrawer
        api={api}
        sessionId={sessionId}
        gitStatus={gitStatus}
        onCommitted={refetchGit}
        onStaged={refetchGit}
        onClose={() => setCommitOpen(false)}
    />
)}
```

- [ ] **Step 4: 运行 web 测试**

```bash
cd /home/hwwwww/Project/hapi/web && bun run test
```

- [ ] **Step 5: 运行 typecheck**

```bash
cd /home/hwwwww/Project/hapi/web && bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SessionFiles/CommitDrawer.tsx web/src/routes/sessions/files.tsx
git commit -m "feat(web): add CommitDrawer with stage/unstage and commit support"
```

