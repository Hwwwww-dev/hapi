# Git 操作增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 HAPI 项目新增 7 项高频 Git 操作（分支改名、设置 upstream、Remote 管理、合并 UI、Cherry-pick、Reset 变体、Tag 管理）

**Architecture:** 四层透传架构 CLI Handler → RpcGateway → SyncEngine(透传) → Hub Route → ApiClient → UI。每个功能独立完成全链路，按优先级逐个交付。

**Tech Stack:** Bun + TypeScript, Hono (HTTP), Socket.IO (RPC), React 19 + TanStack Query, Zod (validation)

**Spec:** `docs/superpowers/specs/2026-03-19-git-operations-enhancement-design.md`

---

## 文件结构

### 需修改的文件

| 文件 | 职责 |
|------|------|
| `cli/src/modules/common/handlers/git.ts` | CLI RPC Handler，注册 git 子命令 |
| `hub/src/sync/rpcGateway.ts` | RPC Gateway，封装 Socket.IO 调用 |
| `hub/src/sync/syncEngine.ts` | SyncEngine，透传到 RpcGateway |
| `hub/src/web/routes/git.ts` | Hub HTTP 路由，Zod 校验 + 调用 SyncEngine |
| `web/src/api/client.ts` | 前端 API 客户端 |
| `web/src/types/api.ts` | 前端类型定义 |
| `web/src/lib/gitParsers.ts` | Git 输出解析器 |
| `web/src/components/SessionFiles/BranchesTab.tsx` | 分支管理 UI |
| `web/src/components/SessionFiles/HistoryTab.tsx` | 提交历史 UI |
| `web/src/components/SessionFiles/CommitRow.tsx` | 提交行组件 |
| `web/src/lib/locales/en.ts` | 英文翻译 |
| `web/src/lib/locales/zh-CN.ts` | 中文翻译 |

### 需新增的文件

| 文件 | 职责 |
|------|------|
| `web/src/hooks/queries/useGitRemotes.ts` | Remote 列表查询 hook |
| `web/src/hooks/queries/useGitTags.ts` | Tag 列表查询 hook |

---

## 关键模式参考

### CLI Handler 模式
```typescript
rpcHandlerManager.registerHandler<RequestType, GitCommandResponse>('rpc-name', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    // 参数校验...
    return await queuedGitCommand([...args], resolved.cwd, data.timeout)
})
```

### RpcGateway 模式
```typescript
async methodName(sessionId: string, options: OptionsType): Promise<RpcCommandResponse> {
    return await this.sessionRpc(sessionId, 'rpc-name', options) as RpcCommandResponse
}
```

### SyncEngine 模式（纯透传）
```typescript
async methodName(sessionId: string, options: OptionsType): Promise<RpcCommandResponse> {
    return await this.rpcGateway.methodName(sessionId, options)
}
```

### Hub Route 模式
```typescript
app.post('/sessions/:id/endpoint', async (c) => {
    const engine = requireSyncEngine(c, getSyncEngine)
    if (engine instanceof Response) return engine
    const sessionResult = requireSessionFromParam(c, engine)
    if (sessionResult instanceof Response) return sessionResult
    const sessionPath = sessionResult.session.metadata?.path
    if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
    const body = schema.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'Invalid request' }, 400)
    const result = await runRpc(() => engine.methodName(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
    return c.json(result)
})
```

### ApiClient 模式
```typescript
async methodName(sessionId: string, param1: string, param2?: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/endpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ param1, ...(param2 ? { param2 } : {}) })
    })
}
```

---

## Task 1: 分支改名 (git-rename-branch) — 后端全链路

**Files:**
- Modify: `cli/src/modules/common/handlers/git.ts` (在 `registerGitHandlers` 末尾追加)
- Modify: `hub/src/sync/rpcGateway.ts` (在 git 方法区域追加)
- Modify: `hub/src/sync/syncEngine.ts` (在 git 方法区域追加)
- Modify: `hub/src/web/routes/git.ts` (在路由末尾追加)
- Modify: `web/src/api/client.ts` (在 git 方法区域追加)

- [ ] **Step 1: CLI Handler — 注册 `git-rename-branch`**

在 `cli/src/modules/common/handlers/git.ts` 的 `registerGitHandlers` 函数末尾（`}` 之前）追加：

```typescript
rpcHandlerManager.registerHandler<{ cwd?: string; oldName: string; newName: string; timeout?: number }, GitCommandResponse>('git-rename-branch', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    if (!data.oldName || typeof data.oldName !== 'string') return rpcError('old branch name is required')
    if (!data.newName || typeof data.newName !== 'string') return rpcError('new branch name is required')
    return await queuedGitCommand(['branch', '-m', data.oldName, data.newName], resolved.cwd, data.timeout)
})
```

- [ ] **Step 2: RpcGateway — 添加 `gitRenameBranch` 方法**

在 `hub/src/sync/rpcGateway.ts` 的 `gitDeleteBranch` 方法之后追加：

```typescript
async gitRenameBranch(sessionId: string, options: { cwd?: string; oldName: string; newName: string }): Promise<RpcCommandResponse> {
    return await this.sessionRpc(sessionId, 'git-rename-branch', options) as RpcCommandResponse
}
```

- [ ] **Step 3: SyncEngine — 添加透传方法**

在 `hub/src/sync/syncEngine.ts` 的 `gitDeleteBranch` 方法之后追加：

```typescript
async gitRenameBranch(sessionId: string, options: { cwd?: string; oldName: string; newName: string }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitRenameBranch(sessionId, options)
}
```

- [ ] **Step 4: Hub Route — 添加 HTTP 端点**

在 `hub/src/web/routes/git.ts` 顶部 schema 区域追加：
```typescript
const gitRenameBranchSchema = z.object({ oldName: z.string().min(1).regex(/^[^-]/), newName: z.string().min(1).regex(/^[^-]/) })
```

在路由区域追加：
```typescript
app.post('/sessions/:id/git-rename-branch', async (c) => {
    const engine = requireSyncEngine(c, getSyncEngine)
    if (engine instanceof Response) return engine
    const sessionResult = requireSessionFromParam(c, engine)
    if (sessionResult instanceof Response) return sessionResult
    const sessionPath = sessionResult.session.metadata?.path
    if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
    const body = gitRenameBranchSchema.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'Invalid request' }, 400)
    const result = await runRpc(() => engine.gitRenameBranch(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
    return c.json(result)
})
```

- [ ] **Step 5: ApiClient — 添加前端方法**

在 `web/src/api/client.ts` 的 `gitDeleteBranch` 方法之后追加：

```typescript
async gitRenameBranch(sessionId: string, oldName: string, newName: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-rename-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName, newName })
    })
}
```

- [ ] **Step 6: Commit**

```bash
git add cli/src/modules/common/handlers/git.ts hub/src/sync/rpcGateway.ts hub/src/sync/syncEngine.ts hub/src/web/routes/git.ts web/src/api/client.ts
git commit -m "feat(git): add git-rename-branch backend pipeline"
```

---

## Task 2: 分支设置 upstream (git-set-upstream) — 后端全链路

**Files:** 同 Task 1 的 5 个文件

- [ ] **Step 1: CLI Handler — 注册 `git-set-upstream`**

```typescript
rpcHandlerManager.registerHandler<{ cwd?: string; branch: string; upstream: string; timeout?: number }, GitCommandResponse>('git-set-upstream', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    if (!data.branch || typeof data.branch !== 'string') return rpcError('branch name is required')
    if (!data.upstream || typeof data.upstream !== 'string') return rpcError('upstream is required')
    return await queuedGitCommand(['branch', `--set-upstream-to=${data.upstream}`, data.branch], resolved.cwd, data.timeout)
})
```

- [ ] **Step 2: RpcGateway**

```typescript
async gitSetUpstream(sessionId: string, options: { cwd?: string; branch: string; upstream: string }): Promise<RpcCommandResponse> {
    return await this.sessionRpc(sessionId, 'git-set-upstream', options) as RpcCommandResponse
}
```

- [ ] **Step 3: SyncEngine**

```typescript
async gitSetUpstream(sessionId: string, options: { cwd?: string; branch: string; upstream: string }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitSetUpstream(sessionId, options)
}
```

- [ ] **Step 4: Hub Route**

Schema: `const gitSetUpstreamSchema = z.object({ branch: z.string().min(1).regex(/^[^-]/), upstream: z.string().min(1) })`

Route: `POST /sessions/:id/git-set-upstream`，调用 `engine.gitSetUpstream`

- [ ] **Step 5: ApiClient**

```typescript
async gitSetUpstream(sessionId: string, branch: string, upstream: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-set-upstream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, upstream })
    })
}
```

- [ ] **Step 6: Commit**

```bash
git add cli/src/modules/common/handlers/git.ts hub/src/sync/rpcGateway.ts hub/src/sync/syncEngine.ts hub/src/web/routes/git.ts web/src/api/client.ts
git commit -m "feat(git): add git-set-upstream backend pipeline"
```

---

## Task 3: Remote URL 管理 — 后端全链路

**Files:** 同 Task 1 的 5 个文件 + `web/src/types/api.ts` + `web/src/lib/gitParsers.ts`

- [ ] **Step 1: 新增类型 `GitRemoteEntry`**

在 `web/src/types/api.ts` 的 `StashEntry` 类型之后追加：

```typescript
export type GitRemoteEntry = {
    name: string
    fetchUrl: string
    pushUrl: string
}
```

- [ ] **Step 2: 新增解析器 `parseRemoteList`**

在 `web/src/lib/gitParsers.ts` 末尾追加：

```typescript
export function parseRemoteList(stdout: string): GitRemoteEntry[] {
    const lines = stdout.split('\n').filter(l => l.trim())
    const map = new Map<string, { fetchUrl: string; pushUrl: string }>()
    for (const line of lines) {
        const match = line.match(/^(\S+)\t(\S+)\s+\((fetch|push)\)$/)
        if (!match) continue
        const [, name, url, type] = match
        const entry = map.get(name) ?? { fetchUrl: '', pushUrl: '' }
        if (type === 'fetch') entry.fetchUrl = url
        else entry.pushUrl = url
        map.set(name, entry)
    }
    return Array.from(map.entries()).map(([name, urls]) => ({ name, ...urls }))
}
```

需要在文件顶部导入区域确认 `GitRemoteEntry` 类型已导入（或在 gitParsers.ts 内联定义返回类型）。

- [ ] **Step 3: CLI Handlers — 注册 4 个 remote 命令**

```typescript
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
```

- [ ] **Step 4: RpcGateway — 4 个方法**

```typescript
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
```

- [ ] **Step 5: SyncEngine — 4 个透传方法**

```typescript
async gitRemoteList(sessionId: string, options: { cwd?: string }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitRemoteList(sessionId, options)
}

async gitRemoteAdd(sessionId: string, options: { cwd?: string; name: string; url: string }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitRemoteAdd(sessionId, options)
}

async gitRemoteRemove(sessionId: string, options: { cwd?: string; name: string }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitRemoteRemove(sessionId, options)
}

async gitRemoteSetUrl(sessionId: string, options: { cwd?: string; name: string; url: string }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitRemoteSetUrl(sessionId, options)
}
```

- [ ] **Step 6: Hub Routes — 4 个端点**

Schemas:
```typescript
const gitRemoteAddSchema = z.object({ name: z.string().min(1).regex(/^[^-]/), url: z.string().min(1) })
const gitRemoteRemoveSchema = z.object({ name: z.string().min(1) })
const gitRemoteSetUrlSchema = z.object({ name: z.string().min(1), url: z.string().min(1) })
```

Routes:
- `GET /sessions/:id/git-remote-list` → `engine.gitRemoteList`
- `POST /sessions/:id/git-remote-add` → `engine.gitRemoteAdd`
- `POST /sessions/:id/git-remote-remove` → `engine.gitRemoteRemove`
- `POST /sessions/:id/git-remote-set-url` → `engine.gitRemoteSetUrl`

- [ ] **Step 7: ApiClient — 4 个方法**

```typescript
async gitRemoteList(sessionId: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-remote-list`)
}

async gitRemoteAdd(sessionId: string, name: string, url: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-remote-add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url })
    })
}

async gitRemoteRemove(sessionId: string, name: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-remote-remove`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    })
}

async gitRemoteSetUrl(sessionId: string, name: string, url: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-remote-set-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url })
    })
}
```

- [ ] **Step 8: Commit**

```bash
git add cli/src/modules/common/handlers/git.ts hub/src/sync/rpcGateway.ts hub/src/sync/syncEngine.ts hub/src/web/routes/git.ts web/src/api/client.ts web/src/types/api.ts web/src/lib/gitParsers.ts
git commit -m "feat(git): add remote management backend pipeline"
```

---

## Task 4: Cherry-pick + Cherry-pick Abort — 后端全链路

**Files:** 同 Task 1 的 5 个文件

- [ ] **Step 1: CLI Handlers**

```typescript
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
```

- [ ] **Step 2: RpcGateway**

```typescript
async gitCherryPick(sessionId: string, options: { cwd?: string; hash: string }): Promise<RpcCommandResponse> {
    return await this.sessionRpc(sessionId, 'git-cherry-pick', options) as RpcCommandResponse
}

async gitCherryPickAbort(sessionId: string, options: { cwd?: string }): Promise<RpcCommandResponse> {
    return await this.sessionRpc(sessionId, 'git-cherry-pick-abort', options) as RpcCommandResponse
}
```

- [ ] **Step 3: SyncEngine**

```typescript
async gitCherryPick(sessionId: string, options: { cwd?: string; hash: string }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitCherryPick(sessionId, options)
}

async gitCherryPickAbort(sessionId: string, options: { cwd?: string }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitCherryPickAbort(sessionId, options)
}
```

- [ ] **Step 4: Hub Routes**

Schemas:
```typescript
const gitCherryPickSchema = z.object({ hash: z.string().min(4).regex(/^[a-f0-9]+$/) })
```

Routes:
```typescript
app.post('/sessions/:id/git-cherry-pick', async (c) => {
    const engine = requireSyncEngine(c, getSyncEngine)
    if (engine instanceof Response) return engine
    const sessionResult = requireSessionFromParam(c, engine)
    if (sessionResult instanceof Response) return sessionResult
    const sessionPath = sessionResult.session.metadata?.path
    if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
    const body = gitCherryPickSchema.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'Invalid request' }, 400)
    const result = await runRpc(() => engine.gitCherryPick(sessionResult.sessionId, { cwd: sessionPath, ...body.data }))
    return c.json(result)
})

app.post('/sessions/:id/git-cherry-pick-abort', async (c) => {
    const engine = requireSyncEngine(c, getSyncEngine)
    if (engine instanceof Response) return engine
    const sessionResult = requireSessionFromParam(c, engine)
    if (sessionResult instanceof Response) return sessionResult
    const sessionPath = sessionResult.session.metadata?.path
    if (!sessionPath) return c.json({ success: false, error: 'Session path not available' })
    const result = await runRpc(() => engine.gitCherryPickAbort(sessionResult.sessionId, { cwd: sessionPath }))
    return c.json(result)
})
```

- [ ] **Step 5: ApiClient**

```typescript
async gitCherryPick(sessionId: string, hash: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-cherry-pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash })
    })
}

async gitCherryPickAbort(sessionId: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-cherry-pick-abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    })
}
```

- [ ] **Step 6: Commit**

```bash
git add cli/src/modules/common/handlers/git.ts hub/src/sync/rpcGateway.ts hub/src/sync/syncEngine.ts hub/src/web/routes/git.ts web/src/api/client.ts
git commit -m "feat(git): add cherry-pick and cherry-pick-abort backend pipeline"
```

---

## Task 5: Reset 变体 (git-reset) — 后端全链路

**Files:** 同 Task 1 的 5 个文件

- [ ] **Step 1: CLI Handler**

```typescript
rpcHandlerManager.registerHandler<{ cwd?: string; ref: string; mode: 'soft' | 'mixed' | 'hard'; timeout?: number }, GitCommandResponse>('git-reset', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    if (!data.ref || typeof data.ref !== 'string') return rpcError('ref is required')
    const validModes = ['soft', 'mixed', 'hard']
    if (!validModes.includes(data.mode)) return rpcError('mode must be soft, mixed, or hard')
    return await queuedGitCommand(['reset', `--${data.mode}`, data.ref], resolved.cwd, data.timeout)
})
```

- [ ] **Step 2: RpcGateway + SyncEngine + Hub Route + ApiClient**

RpcGateway:
```typescript
async gitReset(sessionId: string, options: { cwd?: string; ref: string; mode: 'soft' | 'mixed' | 'hard' }): Promise<RpcCommandResponse> {
    return await this.sessionRpc(sessionId, 'git-reset', options) as RpcCommandResponse
}
```

SyncEngine:
```typescript
async gitReset(sessionId: string, options: { cwd?: string; ref: string; mode: 'soft' | 'mixed' | 'hard' }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitReset(sessionId, options)
}
```

Hub Schema:
```typescript
const gitResetSchema = z.object({ ref: z.string().min(4).regex(/^[a-f0-9]+$|^[a-zA-Z0-9_./-]+$/), mode: z.enum(['soft', 'mixed', 'hard']) })
```

Hub Route: `POST /sessions/:id/git-reset`，调用 `engine.gitReset`

ApiClient:
```typescript
async gitReset(sessionId: string, ref: string, mode: 'soft' | 'mixed' | 'hard'): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref, mode })
    })
}
```

- [ ] **Step 3: 清理旧 `gitResetSoft`**

现有 `web/src/api/client.ts` 中的 `gitResetSoft` 方法后端三层（CLI/RpcGateway/Hub Route）均不存在，是死代码。

操作：
1. 删除 `web/src/api/client.ts` 中的 `gitResetSoft` 方法
2. 搜索所有调用 `gitResetSoft` 的地方（`HistoryTab.tsx` 的 uncommit 功能），改为调用 `api.gitReset(sessionId, ref, 'soft')`
3. 同时需要在 Hub Route 中添加 `git-reset-soft` 端点作为旧端点的实现（如果有其他地方调用），或确认只有 HistoryTab 使用

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(git): add git-reset with soft/mixed/hard modes"
```

---

## Task 6: Tag 管理 — 后端全链路

**Files:** 同 Task 1 的 5 个文件 + `web/src/types/api.ts` + `web/src/lib/gitParsers.ts`

- [ ] **Step 1: 新增类型 `GitTagEntry`**

在 `web/src/types/api.ts` 追加：
```typescript
export type GitTagEntry = {
    name: string
    hash: string
    short: string
    date: number
    subject: string
}
```

- [ ] **Step 2: 新增解析器 `parseTagList`**

在 `web/src/lib/gitParsers.ts` 末尾追加：
```typescript
export function parseTagList(stdout: string): GitTagEntry[] {
    return stdout.split('\n').filter(l => l.trim()).map(line => {
        const [name, hash, short, dateStr, ...subjectParts] = line.split('\x00')
        return {
            name: name ?? '',
            hash: hash ?? '',
            short: short ?? '',
            date: parseInt(dateStr ?? '0', 10),
            subject: subjectParts.join('\x00')
        }
    })
}
```

- [ ] **Step 3: CLI Handlers — 3 个 tag 命令**

```typescript
rpcHandlerManager.registerHandler<{ cwd?: string; timeout?: number }, GitCommandResponse>('git-tag-list', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    return await queuedGitCommand(['tag', '-l', '--sort=-creatordate', '--format=%(refname:strip=2)%x00%(objectname)%x00%(objectname:short)%x00%(creatordate:unix)%x00%(subject)'], resolved.cwd, data.timeout)
})

rpcHandlerManager.registerHandler<{ cwd?: string; name: string; message?: string; ref?: string; timeout?: number }, GitCommandResponse>('git-tag-create', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    if (!data.name || typeof data.name !== 'string') return rpcError('tag name is required')
    const args = data.message
        ? ['tag', '-a', data.name, '-m', data.message]
        : ['tag', data.name]
    if (data.ref) args.push(data.ref)
    return await queuedGitCommand(args, resolved.cwd, data.timeout)
})

rpcHandlerManager.registerHandler<{ cwd?: string; name: string; timeout?: number }, GitCommandResponse>('git-tag-delete', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    if (!data.name || typeof data.name !== 'string') return rpcError('tag name is required')
    return await queuedGitCommand(['tag', '-d', data.name], resolved.cwd, data.timeout)
})
```

- [ ] **Step 4: RpcGateway + SyncEngine + Hub Routes + ApiClient**

RpcGateway:
```typescript
async gitTagList(sessionId: string, options: { cwd?: string }): Promise<RpcCommandResponse> {
    return await this.sessionRpc(sessionId, 'git-tag-list', options) as RpcCommandResponse
}

async gitTagCreate(sessionId: string, options: { cwd?: string; name: string; message?: string; ref?: string }): Promise<RpcCommandResponse> {
    return await this.sessionRpc(sessionId, 'git-tag-create', options) as RpcCommandResponse
}

async gitTagDelete(sessionId: string, options: { cwd?: string; name: string }): Promise<RpcCommandResponse> {
    return await this.sessionRpc(sessionId, 'git-tag-delete', options) as RpcCommandResponse
}
```

SyncEngine: 同签名，透传到 `this.rpcGateway.gitTagXxx`。

Hub Schemas:
```typescript
const gitTagCreateSchema = z.object({ name: z.string().min(1).regex(/^[^-]/), message: z.string().optional(), ref: z.string().optional() })
const gitTagDeleteSchema = z.object({ name: z.string().min(1) })
```

Hub Routes:
- `GET /sessions/:id/git-tag-list` → `engine.gitTagList(sessionResult.sessionId, { cwd: sessionPath })`
- `POST /sessions/:id/git-tag-create` → `engine.gitTagCreate`
- `POST /sessions/:id/git-tag-delete` → `engine.gitTagDelete`

ApiClient:
```typescript
async gitTagList(sessionId: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-tag-list`)
}

async gitTagCreate(sessionId: string, name: string, message?: string, ref?: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-tag-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...(message ? { message } : {}), ...(ref ? { ref } : {}) })
    })
}

async gitTagDelete(sessionId: string, name: string): Promise<GitCommandResponse> {
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-tag-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    })
}
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(git): add tag management backend pipeline"
```

---

## Task 7: 国际化翻译 — 所有新功能的 i18n key

**Files:**
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

- [ ] **Step 1: 英文翻译**

在 `en.ts` 中追加以下 key（遵循现有命名规范）：

```typescript
// Branch actions
'git.rename': 'Rename',
'git.renaming': 'Renaming…',
'git.setUpstream': 'Set Upstream',
'git.settingUpstream': 'Setting…',
'git.mergeTo': 'Merge into current',
'git.merging': 'Merging…',
'dialog.git.rename.title': 'Rename Branch',
'dialog.git.rename.placeholder': 'New branch name',
'dialog.git.setUpstream.title': 'Set Upstream Branch',
'dialog.git.setUpstream.description': 'Select upstream for branch "{branch}"',
'dialog.git.merge.title': 'Merge Branch',
'dialog.git.merge.description': 'Merge "{source}" into "{target}"?',
'dialog.git.merge.confirm': 'Merge',
'dialog.git.merge.confirming': 'Merging…',
'notify.git.renameOk': 'Branch renamed',
'notify.git.setUpstreamOk': 'Upstream set',
'notify.git.mergeOk': 'Branch merged',

// Remote management
'git.remotes': 'Remotes ({n})',
'git.addRemote': 'Add Remote',
'git.remoteName': 'Remote name',
'git.remoteUrl': 'Remote URL',
'git.editUrl': 'Edit URL',
'git.removeRemote': 'Remove',
'dialog.git.removeRemote.title': 'Remove Remote',
'dialog.git.removeRemote.description': 'Remove remote "{name}"? This cannot be undone.',
'dialog.git.removeRemote.confirm': 'Remove',
'dialog.git.removeRemote.confirming': 'Removing…',
'notify.git.remoteAddOk': 'Remote added',
'notify.git.remoteRemoveOk': 'Remote removed',
'notify.git.remoteSetUrlOk': 'Remote URL updated',

// Cherry-pick
'git.cherryPick': 'Cherry-pick',
'git.cherryPickAbort': 'Abort Cherry-pick',
'dialog.git.cherryPick.title': 'Cherry-pick Commit',
'dialog.git.cherryPick.description': 'Cherry-pick commit "{short}: {subject}"?',
'dialog.git.cherryPick.confirm': 'Cherry-pick',
'dialog.git.cherryPick.confirming': 'Cherry-picking…',
'notify.git.cherryPickOk': 'Commit cherry-picked',

// Reset
'git.resetMixed': 'Reset to here (mixed)',
'git.resetHard': 'Hard reset to here',
'dialog.git.resetMixed.title': 'Reset (Mixed)',
'dialog.git.resetMixed.description': 'Reset to "{short}"? Staged changes will be unstaged but working directory preserved.',
'dialog.git.resetMixed.confirm': 'Reset',
'dialog.git.resetMixed.confirming': 'Resetting…',
'dialog.git.resetHard.title': 'Hard Reset',
'dialog.git.resetHard.description': 'Hard reset to "{short}"? ALL uncommitted changes will be PERMANENTLY LOST. Type "RESET" to confirm.',
'dialog.git.resetHard.confirm': 'Hard Reset',
'dialog.git.resetHard.confirming': 'Resetting…',
'dialog.git.resetHard.inputPlaceholder': 'Type RESET to confirm',
'notify.git.resetOk': 'Reset complete',

// Tags
'git.tags': 'Tags ({n})',
'git.createTag': 'Create Tag',
'git.tagName': 'Tag name',
'git.tagMessage': 'Message (optional)',
'git.deleteTag': 'Delete',
'git.noTags': 'No tags',
'dialog.git.createTag.title': 'Create Tag',
'dialog.git.deleteTag.title': 'Delete Tag',
'dialog.git.deleteTag.description': 'Delete tag "{name}"?',
'dialog.git.deleteTag.confirm': 'Delete',
'dialog.git.deleteTag.confirming': 'Deleting…',
'notify.git.tagCreateOk': 'Tag created',
'notify.git.tagDeleteOk': 'Tag deleted',
```

- [ ] **Step 2: 中文翻译**

在 `zh-CN.ts` 中追加：

```typescript
// 分支操作
'git.rename': '改名',
'git.renaming': '改名中…',
'git.setUpstream': '设置上游',
'git.settingUpstream': '设置中…',
'git.mergeTo': '合并到当前分支',
'git.merging': '合并中…',
'dialog.git.rename.title': '重命名分支',
'dialog.git.rename.placeholder': '新分支名',
'dialog.git.setUpstream.title': '设置上游分支',
'dialog.git.setUpstream.description': '为分支 "{branch}" 选择上游',
'dialog.git.merge.title': '合并分支',
'dialog.git.merge.description': '将 "{source}" 合并到 "{target}"？',
'dialog.git.merge.confirm': '合并',
'dialog.git.merge.confirming': '合并中…',
'notify.git.renameOk': '分支已重命名',
'notify.git.setUpstreamOk': '上游已设置',
'notify.git.mergeOk': '分支已合并',

// Remote 管理
'git.remotes': 'Remotes ({n})',
'git.addRemote': '添加 Remote',
'git.remoteName': 'Remote 名称',
'git.remoteUrl': 'Remote URL',
'git.editUrl': '修改 URL',
'git.removeRemote': '移除',
'dialog.git.removeRemote.title': '移除 Remote',
'dialog.git.removeRemote.description': '移除 remote "{name}"？此操作不可撤销。',
'dialog.git.removeRemote.confirm': '移除',
'dialog.git.removeRemote.confirming': '移除中…',
'notify.git.remoteAddOk': 'Remote 已添加',
'notify.git.remoteRemoveOk': 'Remote 已移除',
'notify.git.remoteSetUrlOk': 'Remote URL 已更新',

// Cherry-pick
'git.cherryPick': 'Cherry-pick',
'git.cherryPickAbort': '中止 Cherry-pick',
'dialog.git.cherryPick.title': 'Cherry-pick 提交',
'dialog.git.cherryPick.description': 'Cherry-pick 提交 "{short}: {subject}"？',
'dialog.git.cherryPick.confirm': 'Cherry-pick',
'dialog.git.cherryPick.confirming': 'Cherry-picking…',
'notify.git.cherryPickOk': '提交已 Cherry-pick',

// Reset
'git.resetMixed': '重置到此处 (mixed)',
'git.resetHard': '硬重置到此处',
'dialog.git.resetMixed.title': '重置 (Mixed)',
'dialog.git.resetMixed.description': '重置到 "{short}"？暂存区将被重置，但工作目录保留。',
'dialog.git.resetMixed.confirm': '重置',
'dialog.git.resetMixed.confirming': '重置中…',
'dialog.git.resetHard.title': '硬重置',
'dialog.git.resetHard.description': '硬重置到 "{short}"？所有未提交的更改将永久丢失。输入 "RESET" 确认。',
'dialog.git.resetHard.confirm': '硬重置',
'dialog.git.resetHard.confirming': '重置中…',
'dialog.git.resetHard.inputPlaceholder': '输入 RESET 确认',
'notify.git.resetOk': '重置完成',

// Tags
'git.tags': '标签 ({n})',
'git.createTag': '创建标签',
'git.tagName': '标签名',
'git.tagMessage': '描述（可选）',
'git.deleteTag': '删除',
'git.noTags': '暂无标签',
'dialog.git.createTag.title': '创建标签',
'dialog.git.deleteTag.title': '删除标签',
'dialog.git.deleteTag.description': '删除标签 "{name}"？',
'dialog.git.deleteTag.confirm': '删除',
'dialog.git.deleteTag.confirming': '删除中…',
'notify.git.tagCreateOk': '标签已创建',
'notify.git.tagDeleteOk': '标签已删除',
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/locales/en.ts web/src/lib/locales/zh-CN.ts
git commit -m "feat(i18n): add translation keys for new git operations"
```

---

## Task 8: BranchesTab UI — BranchActionMenu + 改名/Upstream/合并 (含功能 #4: 分支合并 UI 补全)

**Files:**
- Modify: `web/src/components/SessionFiles/BranchesTab.tsx`

- [ ] **Step 1: 添加 BranchActionMenu 组件**

在 `BranchesTab.tsx` 中，参考 `CommitRow.tsx` 的 `CommitActionMenu` 模式，新增 `BranchActionMenu` 组件。菜单项：
- 改名（仅本地分支）
- 设置上游（仅本地分支）
- 合并到当前分支（仅非当前分支）
- 分隔线
- 删除（仅非当前分支，迁移现有删除逻辑）

- [ ] **Step 2: 修改 BranchRow 组件**

在 `BranchRow` 中集成 `BranchActionMenu`，在分支名右侧显示 `⋯` 按钮。

- [ ] **Step 3: 实现改名交互**

点击"改名"后，分支名变为 inline input，回车确认调用 `api.gitRenameBranch`，成功后 refetch。

- [ ] **Step 4: 实现设置上游交互**

点击"设置上游"后，弹出远程分支选择列表（复用 `useGitBranches` 的 remote 数据），选择后调用 `api.gitSetUpstream`。

- [ ] **Step 5: 实现合并交互**

点击"合并到当前分支"后，弹出 ConfirmDialog，确认后调用 `api.gitMerge`，成功后刷新。

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SessionFiles/BranchesTab.tsx
git commit -m "feat(ui): add BranchActionMenu with rename, upstream, merge"
```

---

## Task 9: BranchesTab UI — Remote 管理区域

**Files:**
- Create: `web/src/hooks/queries/useGitRemotes.ts`
- Modify: `web/src/components/SessionFiles/BranchesTab.tsx`

- [ ] **Step 1: 创建 useGitRemotes hook**

```typescript
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { parseRemoteList } from '@/lib/gitParsers'
import type { GitRemoteEntry } from '@/types/api'

export function useGitRemotes(api: ApiClient, sessionId: string) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['git-remotes', sessionId],
        queryFn: async () => {
            const res = await api.gitRemoteList(sessionId)
            if (!res.success) throw new Error(res.error ?? 'Failed to fetch remotes')
            return parseRemoteList(res.stdout ?? '')
        }
    })
    return { remotes: data ?? [] as GitRemoteEntry[], isLoading, error, refetch }
}
```

- [ ] **Step 2: 在 BranchesTab 中添加 Remotes 折叠区域**

在远程分支区域之后，添加 "Remotes" 折叠区域：
- 使用 `useGitRemotes` 获取数据
- 每个 remote 显示 name + fetchUrl
- 每行有 `⋯` 菜单（修改 URL / 删除）
- 底部"添加 Remote"按钮

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/queries/useGitRemotes.ts web/src/components/SessionFiles/BranchesTab.tsx
git commit -m "feat(ui): add remote management section in BranchesTab"
```

---

## Task 10: CommitRow UI — Cherry-pick + Reset + Tag 菜单扩展

**Files:**
- Modify: `web/src/components/SessionFiles/CommitRow.tsx`
- Modify: `web/src/components/SessionFiles/HistoryTab.tsx`

- [ ] **Step 1: 扩展 CommitActionMenu**

在 `CommitRow.tsx` 的 `CommitActionMenu` 中新增菜单项：
- Cherry-pick
- 创建 Tag
- 分隔线
- Uncommit (soft reset) — 保留现有
- Reset to here (mixed) — 新增
- Hard reset to here — 新增，红色文字

- [ ] **Step 2: 实现 Cherry-pick 交互**

点击后弹出 ConfirmDialog，确认后调用 `api.gitCherryPick`。需要将 `onCherryPick` 回调从 HistoryTab 传入。

- [ ] **Step 3: 实现 Reset 交互**

- mixed reset: 普通 ConfirmDialog
- hard reset: 增强 ConfirmDialog，需要输入 "RESET" 文字确认。可以在 ConfirmDialog 中添加 `requireInput` prop，或在 CommitRow 内部实现输入验证逻辑。

调用 `api.gitReset(sessionId, hash, mode)`。

- [ ] **Step 4: 实现创建 Tag 交互**

点击后弹出小表单（tag name + optional message），确认后调用 `api.gitTagCreate(sessionId, name, message, commit.hash)`。

- [ ] **Step 5: 更新 HistoryTab 传递回调**

HistoryTab 需要传递 `onCherryPick`, `onReset`, `onCreateTag` 等回调给 CommitRow，并在操作成功后刷新 status + log。

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SessionFiles/CommitRow.tsx web/src/components/SessionFiles/HistoryTab.tsx
git commit -m "feat(ui): extend CommitActionMenu with cherry-pick, reset, tag"
```

---

## Task 11: HistoryTab UI — Tags 视图

**Files:**
- Create: `web/src/hooks/queries/useGitTags.ts`
- Modify: `web/src/components/SessionFiles/HistoryTab.tsx`

- [ ] **Step 1: 创建 useGitTags hook**

```typescript
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { parseTagList } from '@/lib/gitParsers'

export function useGitTags(api: ApiClient, sessionId: string) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['git-tags', sessionId],
        queryFn: async () => {
            const res = await api.gitTagList(sessionId)
            if (!res.success) throw new Error(res.error ?? 'Failed to fetch tags')
            return parseTagList(res.stdout ?? '')
        }
    })
    return { tags: data ?? [], isLoading, error, refetch }
}
```

- [ ] **Step 2: 在 HistoryTab 顶部添加 Commits/Tags 切换**

添加简单的 tab 切换（两个按钮），默认显示 Commits（现有逻辑），切换到 Tags 时显示 tag 列表。

Tag 列表每行显示：tag name, short hash, 相对时间, subject。支持删除操作（ConfirmDialog）。

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/queries/useGitTags.ts web/src/components/SessionFiles/HistoryTab.tsx
git commit -m "feat(ui): add tags view in HistoryTab"
```

---

## Task 12: 最终验证与清理

- [ ] **Step 1: 检查 TypeScript 编译**

Run: `cd /home/hwwwww/Project/hapi && bun run build` 或对应的 type-check 命令
Expected: 无类型错误

- [ ] **Step 2: 检查所有新增 import 是否正确**

确认 `gitParsers.ts` 中的 `GitRemoteEntry` 和 `GitTagEntry` 类型导入正确。

- [ ] **Step 3: 清理未使用的旧代码**

如果 `gitResetSoft` 的旧 Hub Route 端点存在，确认是否需要保留向后兼容或删除。

- [ ] **Step 4: Final commit**

```bash
git commit -m "chore: cleanup and verify git operations enhancement"
```
