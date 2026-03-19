# Git 操作增强设计文档

## 概述

为 HAPI 项目增加 7 项高频实用 Git 操作，采用逐功能独立实现策略（方案 A），每个功能完成全链路（CLI → RpcGateway → Hub Route → ApiClient → UI）。

## 需求范围

| # | 功能 | 优先级 | 风险等级 |
|---|------|--------|---------|
| 1 | 分支改名 | P0 | 低 |
| 2 | 分支设置 upstream | P0 | 低 |
| 3 | Remote URL 管理 | P1 | 中 |
| 4 | 分支合并 UI 补全 | P1 | 中 |
| 5 | Cherry-pick | P1 | 中 |
| 6 | Reset 变体 | P2 | 高(hard) |
| 7 | Tag 管理 | P2 | 低 |

## 架构

遵循现有四层架构，每个新功能都需要修改以下文件：

```
cli/src/modules/common/handlers/git.ts          # CLI RPC Handler
hub/src/sync/rpcGateway.ts                       # RPC Gateway 方法
hub/src/web/routes/git.ts                        # Hub HTTP Route
web/src/api/client.ts                            # ApiClient 方法
web/src/components/SessionFiles/                  # UI 组件
```

## 详细设计

### 1. 分支改名 (git-rename-branch)

**CLI Handler:**
```typescript
// RPC: 'git-rename-branch'
// 参数: { cwd?: string; oldName: string; newName: string }
// 命令: git branch -m <oldName> <newName>
```

**Hub Route:** `POST /sessions/:id/git-rename-branch`
**Schema:** `{ oldName: z.string().min(1), newName: z.string().min(1) }`

**UI 位置:** BranchesTab → 本地分支行 → `⋯` 菜单 → "改名"
- 点击后弹出 inline input 替换分支名文字
- 回车确认，Escape 取消
- 成功后刷新分支列表

### 2. 分支设置 upstream (git-set-upstream)

**CLI Handler:**
```typescript
// RPC: 'git-set-upstream'
// 参数: { cwd?: string; branch: string; upstream: string }
// 命令: git branch --set-upstream-to=<upstream> <branch>
```

**Hub Route:** `POST /sessions/:id/git-set-upstream`
**Schema:** `{ branch: z.string().min(1), upstream: z.string().min(1) }`

**UI 位置:** BranchesTab → 本地分支行 → `⋯` 菜单 → "设置上游"
- 弹出选择器，列出远程分支（复用 `gitRemoteBranches` 数据）
- 选择后直接执行
- 成功后 toast 提示

### 3. Remote URL 管理

**新增 4 个 CLI Handler:**

| RPC 命令 | Git 命令 | 参数 |
|---------|---------|------|
| `git-remote-list` | `git remote -v` | `{ cwd? }` |
| `git-remote-add` | `git remote add <name> <url>` | `{ cwd?, name, url }` |
| `git-remote-remove` | `git remote remove <name>` | `{ cwd?, name }` |
| `git-remote-set-url` | `git remote set-url <name> <url>` | `{ cwd?, name, url }` |

**新增类型:**
```typescript
type GitRemoteEntry = {
    name: string
    fetchUrl: string
    pushUrl: string
}
```

**新增解析器:** `parseRemoteList(stdout: string): GitRemoteEntry[]`
- 解析 `git remote -v` 输出格式: `origin\thttps://... (fetch)\norigin\thttps://... (push)`

**Hub Routes:**
- `GET /sessions/:id/git-remote-list`
- `POST /sessions/:id/git-remote-add` → `{ name, url }`
- `POST /sessions/:id/git-remote-remove` → `{ name }`
- `POST /sessions/:id/git-remote-set-url` → `{ name, url }`

**UI 位置:** BranchesTab → 底部新增 "Remotes" 折叠区域
- 展示 remote 列表（name + fetch URL）
- 每个 remote 行有 `⋯` 菜单：修改 URL / 删除
- 底部 "添加 Remote" 按钮，弹出 name + url 输入框

### 4. 分支合并 UI 补全

**后端已存在:** `git-merge` RPC + Hub Route + ApiClient 方法均已实现。

**UI 位置:** BranchesTab → 本地分支行 → `⋯` 菜单 → "合并到当前分支"
- 仅对非当前分支显示
- 点击后弹出 ConfirmDialog："将 `feature-x` 合并到 `main`？"
- 合并后刷新 status + branches + history
- 合并冲突时显示 stderr 错误信息

### 5. Cherry-pick (git-cherry-pick)

**CLI Handler:**
```typescript
// RPC: 'git-cherry-pick'
// 参数: { cwd?: string; hash: string }
// 命令: git cherry-pick <hash>
```

**Hub Route:** `POST /sessions/:id/git-cherry-pick`
**Schema:** `{ hash: z.string().min(1) }`

**UI 位置:** HistoryTab → CommitRow → `⋯` 菜单 → "Cherry-pick"
- 点击后 ConfirmDialog 确认："Cherry-pick 提交 `abc1234: fix bug`？"
- 成功后刷新 status + log
- 冲突时显示 stderr 错误信息

### 6. Reset 变体 (git-reset)

**CLI Handler:**
```typescript
// RPC: 'git-reset'
// 参数: { cwd?: string; ref: string; mode: 'soft' | 'mixed' | 'hard' }
// 命令: git reset --<mode> <ref>
```

现有 `gitResetSoft` 将被此通用 reset 替代（保持向后兼容，旧端点继续工作）。

**Hub Route:** `POST /sessions/:id/git-reset`
**Schema:** `{ ref: z.string().min(1), mode: z.enum(['soft', 'mixed', 'hard']) }`

**安全策略（渐进式）:**
- **soft reset:** 普通 ConfirmDialog（现有 uncommit 行为）
- **mixed reset:** 普通 ConfirmDialog，描述中说明"暂存区将被重置"
- **hard reset:** 增强 ConfirmDialog，需要用户输入 "RESET" 文字确认

**UI 位置:** HistoryTab → CommitRow → `⋯` 菜单扩展：
- "Uncommit (soft)" — 保留现有行为，内部改用通用 reset
- "Reset to here (mixed)" — 新增
- "Hard reset to here" — 新增，destructive 样式 + 文字输入验证

### 7. Tag 管理

**新增 3 个 CLI Handler:**

| RPC 命令 | Git 命令 | 参数 |
|---------|---------|------|
| `git-tag-list` | `git tag -l --sort=-creatordate --format=...` | `{ cwd? }` |
| `git-tag-create` | `git tag [-a] <name> [-m <msg>] [ref]` | `{ cwd?, name, message?, ref? }` |
| `git-tag-delete` | `git tag -d <name>` | `{ cwd?, name }` |

**Tag list 格式:** `%(refname:strip=2)%x00%(objectname:short)%x00%(creatordate:unix)%x00%(subject)`

**新增类型:**
```typescript
type GitTagEntry = {
    name: string
    short: string
    date: number
    subject: string
}
```

**新增解析器:** `parseTagList(stdout: string): GitTagEntry[]`

**Hub Routes:**
- `GET /sessions/:id/git-tag-list`
- `POST /sessions/:id/git-tag-create` → `{ name, message?, ref? }`
- `POST /sessions/:id/git-tag-delete` → `{ name }`

**UI 位置:** HistoryTab 顶部增加 "Tags" 切换视图
- Tag 列表：名称、短 hash、创建时间
- CommitRow `⋯` 菜单增加 "创建 Tag"（ref 为该 commit hash）
- Tag 行支持删除

## UI 组件设计

### BranchActionMenu（新增）

参考现有 `CommitActionMenu` 模式，为 BranchesTab 的分支行提供统一操作菜单：

```
⋯ 菜单项:
├── 改名 (仅本地非当前分支)
├── 设置上游 (仅本地分支)
├── 合并到当前分支 (仅非当前分支)
├── ─────────────
└── 删除 (仅非当前分支，已有功能迁移至此)
```

### CommitActionMenu 扩展

```
⋯ 菜单项:
├── Cherry-pick
├── 创建 Tag
├── ─────────────
├── Uncommit (soft reset) (仅本地提交)
├── Reset to here (mixed)
└── Hard reset to here (destructive)
```

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `cli/src/modules/common/handlers/git.ts` | 修改 | 新增 7+ 个 RPC handler |
| `hub/src/sync/rpcGateway.ts` | 修改 | 新增对应 gateway 方法 |
| `hub/src/web/routes/git.ts` | 修改 | 新增对应 HTTP 路由 |
| `web/src/api/client.ts` | 修改 | 新增对应 API 方法 |
| `web/src/types/api.ts` | 修改 | 新增 GitRemoteEntry, GitTagEntry 类型 |
| `web/src/lib/gitParsers.ts` | 修改 | 新增 parseRemoteList, parseTagList 解析器 |
| `web/src/components/SessionFiles/BranchesTab.tsx` | 修改 | 新增 BranchActionMenu, Remote 区域 |
| `web/src/components/SessionFiles/HistoryTab.tsx` | 修改 | 新增 Tags 视图切换 |
| `web/src/components/SessionFiles/CommitRow.tsx` | 修改 | 扩展 CommitActionMenu |
| `web/src/hooks/queries/useGitRemotes.ts` | 新增 | Remote 列表查询 hook |
| `web/src/hooks/queries/useGitTags.ts` | 新增 | Tag 列表查询 hook |

## 安全考虑

- 所有文件路径操作继续使用 `validatePath` 验证
- hard reset 需要用户输入 "RESET" 文字二次确认
- remote remove 需要 ConfirmDialog 确认
- tag delete 需要 ConfirmDialog 确认
- 所有新命令复用现有 `queuedGitCommand` 队列机制，保证串行执行
