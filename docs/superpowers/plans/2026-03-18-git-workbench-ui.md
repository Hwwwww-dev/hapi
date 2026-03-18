# Git Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the frontend git page into a 3-tab Git Workbench (Changes, History, Branches) with stash sheet, mobile-first.

**Architecture:** Extract inline components from the 594-line files.tsx into focused modules. Add 3 new tab components, 3 new hooks, enhance git-log backend for pagination. Reuse existing API client methods and CSS variable system.

**Tech Stack:** React 19, TanStack Router, TanStack React Query, Tailwind CSS v4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-18-git-workbench-ui-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|:---|:---|
| `web/src/components/SessionFiles/StatusBadge.tsx` | Git file status badge (extracted) |
| `web/src/components/SessionFiles/GitFileRow.tsx` | Git file row with status + actions (extracted) |
| `web/src/components/SessionFiles/GitToolbar.tsx` | Fetch/Pull/Push/Stash toolbar buttons |
| `web/src/components/SessionFiles/ChangesTab.tsx` | Staged/unstaged lists + inline commit |
| `web/src/components/SessionFiles/HistoryTab.tsx` | Commit history timeline with infinite scroll |
| `web/src/components/SessionFiles/CommitRow.tsx` | Single commit entry display |
| `web/src/components/SessionFiles/BranchesTab.tsx` | Branch management (local + remote) |
| `web/src/components/SessionFiles/StashSheet.tsx` | Stash bottom sheet |
| `web/src/hooks/queries/useGitLog.ts` | Paginated commit history hook |
| `web/src/hooks/queries/useGitBranches.ts` | Local + remote branches hook |
| `web/src/hooks/queries/useGitStashList.ts` | Stash list hook |

### Modified Files
| File | Change |
|:---|:---|
| `cli/src/modules/common/handlers/git.ts` | Enhance git-log format + add skip param |
| `hub/src/sync/rpcGateway.ts` | Add skip to gitLog options |
| `hub/src/sync/syncEngine.ts` | Add skip to gitLog options |
| `hub/src/web/routes/git.ts` | Add skip query param to git-log route |
| `web/src/api/client.ts` | Add skip param to gitLog method |
| `web/src/lib/gitParsers.ts` | Add parseGitLog, parseStashList, parseBranchList |
| `web/src/lib/query-keys.ts` | Add gitLog, gitBranches, gitStashList keys |
| `web/src/types/api.ts` | Add CommitEntry, GitBranchEntry, StashEntry types |
| `web/src/routes/sessions/files.tsx` | Slim down to route shell + tab switching |

---

## Chunk 1: Backend Enhancement + Types + Parsers

### Task 1: Enhance git-log across all backend layers

**Files:**
- Modify: `cli/src/modules/common/handlers/git.ts:197-202`
- Modify: `hub/src/sync/rpcGateway.ts` (gitLog method)
- Modify: `hub/src/sync/syncEngine.ts` (gitLog method)
- Modify: `hub/src/web/routes/git.ts` (git-log route)
- Modify: `web/src/api/client.ts` (gitLog method)

- [ ] **Step 1: Update CLI git-log handler**

In `cli/src/modules/common/handlers/git.ts`, replace the git-log handler (lines 197-202):

```typescript
rpcHandlerManager.registerHandler<{ cwd?: string; limit?: number; skip?: number; timeout?: number }, GitCommandResponse>('git-log', async (data) => {
    const resolved = resolveCwd(data.cwd, workingDirectory)
    if (resolved.error) return rpcError(resolved.error)
    const limit = Math.min(Math.max(data.limit ?? 50, 1), 500)
    const args = ['log', '--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s', '-n', String(limit)]
    if (data.skip && data.skip > 0) args.push('--skip=' + String(data.skip))
    return await runGitCommand(args, resolved.cwd, data.timeout)
})
```

- [ ] **Step 2: Update RPC Gateway gitLog**

In `hub/src/sync/rpcGateway.ts`, update the gitLog method signature:

```typescript
async gitLog(sessionId: string, options: { cwd?: string; limit?: number; skip?: number }): Promise<RpcCommandResponse> {
    return await this.sessionRpc(sessionId, 'git-log', options) as RpcCommandResponse
}
```

- [ ] **Step 3: Update SyncEngine gitLog**

In `hub/src/sync/syncEngine.ts`, update the gitLog method signature:

```typescript
async gitLog(sessionId: string, options: { cwd?: string; limit?: number; skip?: number }): Promise<RpcCommandResponse> {
    return await this.rpcGateway.gitLog(sessionId, options)
}
```

- [ ] **Step 4: Update Hub route git-log**

In `hub/src/web/routes/git.ts`, update the gitLogSchema and route:

Schema (near top):
```typescript
const gitLogSchema = z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), skip: z.coerce.number().int().min(0).optional() })
```

Route handler — add `skip: parsed.data.skip` to the engine call:
```typescript
const result = await runRpc(() => engine.gitLog(sessionResult.sessionId, { cwd: sessionPath, limit: parsed.data.limit, skip: parsed.data.skip }))
```

- [ ] **Step 5: Update API client gitLog**

In `web/src/api/client.ts`, update the gitLog method:

```typescript
async gitLog(sessionId: string, limit?: number, skip?: number): Promise<GitCommandResponse> {
    const params = new URLSearchParams()
    if (limit !== undefined) params.set('limit', String(limit))
    if (skip !== undefined) params.set('skip', String(skip))
    const qs = params.toString()
    return await this.request<GitCommandResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/git-log${qs ? `?${qs}` : ''}`)
}
```

- [ ] **Step 6: Commit**

```bash
git add cli/src/modules/common/handlers/git.ts hub/src/sync/rpcGateway.ts hub/src/sync/syncEngine.ts hub/src/web/routes/git.ts web/src/api/client.ts
git commit -m "feat: enhance git-log with structured format and skip pagination"
```

---

### Task 2: Add new frontend types

**Files:**
- Modify: `web/src/types/api.ts`

- [ ] **Step 1: Add CommitEntry, GitBranchEntry, StashEntry types**

Append after the `GitStatusFiles` type (after line 179):

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add web/src/types/api.ts
git commit -m "feat: add CommitEntry, GitBranchEntry, StashEntry types"
```

---

### Task 3: Add parser functions

**Files:**
- Modify: `web/src/lib/gitParsers.ts`

- [ ] **Step 1: Add parseGitLog function**

Append at end of file:

```typescript
export function parseGitLog(stdout: string): CommitEntry[] {
    if (!stdout.trim()) return []
    return stdout.trim().split('\n').map((line) => {
        const parts = line.split('\0')
        if (parts.length < 6) return null
        return {
            hash: parts[0],
            short: parts[1],
            author: parts[2],
            email: parts[3],
            date: parseInt(parts[4], 10),
            subject: parts[5]
        }
    }).filter((entry): entry is CommitEntry => entry !== null)
}

export function parseBranchList(stdout: string, isRemote: boolean, currentBranch: string | null): GitBranchEntry[] {
    if (!stdout.trim()) return []
    return stdout.trim().split('\n').map((line) => {
        const name = line.trim()
        if (!name) return null
        return {
            name,
            isCurrent: !isRemote && name === currentBranch,
            isRemote
        }
    }).filter((entry): entry is GitBranchEntry => entry !== null)
}

export function parseStashList(stdout: string): StashEntry[] {
    if (!stdout.trim()) return []
    return stdout.trim().split('\n').map((line) => {
        const match = line.match(/^stash@\{(\d+)\}:\s*(.*)$/)
        if (!match) return null
        return {
            index: parseInt(match[1], 10),
            message: match[2]
        }
    }).filter((entry): entry is StashEntry => entry !== null)
}
```

Note: Add the necessary imports at the top of the file:
```typescript
import type { CommitEntry, GitBranchEntry, StashEntry } from '@/types/api'
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/gitParsers.ts
git commit -m "feat: add parseGitLog, parseBranchList, parseStashList parsers"
```

---

### Task 4: Add query keys

**Files:**
- Modify: `web/src/lib/query-keys.ts`

- [ ] **Step 1: Add new query keys**

Add after existing keys (line 8 area):

```typescript
gitLog: (sessionId: string) => ['git-log', sessionId] as const,
gitBranches: (sessionId: string) => ['git-branches', sessionId] as const,
gitStashList: (sessionId: string) => ['git-stash-list', sessionId] as const,
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/query-keys.ts
git commit -m "feat: add query keys for git log, branches, stash"
```

---
## Chunk 2: New Hooks

### Task 5: Create useGitLog hook

**Files:**
- Create: `web/src/hooks/queries/useGitLog.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CommitEntry } from '@/types/api'
import { parseGitLog } from '@/lib/gitParsers'
import { queryKeys } from '@/lib/query-keys'

export function useGitLog(api: ApiClient | null, sessionId: string | null, options?: { limit?: number; skip?: number }) {
    const resolvedSessionId = sessionId ?? ''
    const limit = options?.limit ?? 50
    const skip = options?.skip ?? 0

    const query = useQuery({
        queryKey: [...queryKeys.gitLog(resolvedSessionId), limit, skip],
        queryFn: async (): Promise<CommitEntry[]> => {
            if (!api || !resolvedSessionId) return []
            const result = await api.gitLog(resolvedSessionId, limit, skip)
            if (!result.success || !result.stdout) return []
            return parseGitLog(result.stdout)
        },
        enabled: !!api && !!resolvedSessionId
    })

    return {
        commits: query.data ?? [],
        isLoading: query.isLoading,
        error: query.error,
        refetch: query.refetch
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/hooks/queries/useGitLog.ts
git commit -m "feat: add useGitLog hook with pagination"
```

---

### Task 6: Create useGitBranches hook

**Files:**
- Create: `web/src/hooks/queries/useGitBranches.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GitBranchEntry } from '@/types/api'
import { parseBranchList } from '@/lib/gitParsers'
import { queryKeys } from '@/lib/query-keys'

export function useGitBranches(api: ApiClient | null, sessionId: string | null, currentBranch: string | null) {
    const resolvedSessionId = sessionId ?? ''

    const query = useQuery({
        queryKey: queryKeys.gitBranches(resolvedSessionId),
        queryFn: async (): Promise<{ local: GitBranchEntry[]; remote: GitBranchEntry[] }> => {
            if (!api || !resolvedSessionId) return { local: [], remote: [] }
            const [localResult, remoteResult] = await Promise.all([
                api.getGitBranches(resolvedSessionId),
                api.gitRemoteBranches(resolvedSessionId)
            ])
            const local = localResult.success && localResult.stdout
                ? parseBranchList(localResult.stdout, false, currentBranch)
                : []
            const remote = remoteResult.success && remoteResult.stdout
                ? parseBranchList(remoteResult.stdout, true, currentBranch)
                : []
            return { local, remote }
        },
        enabled: !!api && !!resolvedSessionId
    })

    return {
        local: query.data?.local ?? [],
        remote: query.data?.remote ?? [],
        isLoading: query.isLoading,
        error: query.error,
        refetch: query.refetch
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/hooks/queries/useGitBranches.ts
git commit -m "feat: add useGitBranches hook (local + remote)"
```

---

### Task 7: Create useGitStashList hook

**Files:**
- Create: `web/src/hooks/queries/useGitStashList.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { StashEntry } from '@/types/api'
import { parseStashList } from '@/lib/gitParsers'
import { queryKeys } from '@/lib/query-keys'

export function useGitStashList(api: ApiClient | null, sessionId: string | null) {
    const resolvedSessionId = sessionId ?? ''

    const query = useQuery({
        queryKey: queryKeys.gitStashList(resolvedSessionId),
        queryFn: async (): Promise<StashEntry[]> => {
            if (!api || !resolvedSessionId) return []
            const result = await api.gitStashList(resolvedSessionId)
            if (!result.success || !result.stdout) return []
            return parseStashList(result.stdout)
        },
        enabled: !!api && !!resolvedSessionId
    })

    return {
        stashes: query.data ?? [],
        isLoading: query.isLoading,
        error: query.error,
        refetch: query.refetch
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/hooks/queries/useGitStashList.ts
git commit -m "feat: add useGitStashList hook"
```

---

## Chunk 3: Extracted Components

### Task 8: Extract StatusBadge component

**Files:**
- Create: `web/src/components/SessionFiles/StatusBadge.tsx`
- Modify: `web/src/routes/sessions/files.tsx` (remove lines 118-144)

- [ ] **Step 1: Create StatusBadge.tsx**

Extract the StatusBadge function from files.tsx (lines 118-144) into its own file:

```typescript
import type { GitFileStatus } from '@/types/api'

export function StatusBadge({ status }: { status: GitFileStatus['status'] }) {
    // Copy exact implementation from files.tsx lines 119-143
    // Keep all the same CSS variable references and styling
}
```

- [ ] **Step 2: Update files.tsx to import StatusBadge**

Replace inline StatusBadge with import: `import { StatusBadge } from '@/components/SessionFiles/StatusBadge'`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SessionFiles/StatusBadge.tsx web/src/routes/sessions/files.tsx
git commit -m "refactor: extract StatusBadge into standalone component"
```

---

### Task 9: Extract GitFileRow component

**Files:**
- Create: `web/src/components/SessionFiles/GitFileRow.tsx`
- Modify: `web/src/routes/sessions/files.tsx` (remove lines 146-198)

- [ ] **Step 1: Create GitFileRow.tsx**

Extract LineChanges (lines 146-159) and GitFileRow (lines 161-198) from files.tsx. GitFileRow should accept props:

```typescript
import type { GitFileStatus } from '@/types/api'

type GitFileRowProps = {
    file: GitFileStatus
    onOpen: (path: string, staged?: boolean) => void
    onRollback?: (path: string) => void
    showCheckbox?: boolean
    checked?: boolean
    onToggle?: (file: GitFileStatus) => void
}

export function GitFileRow({ file, onOpen, onRollback, showCheckbox, checked, onToggle }: GitFileRowProps) {
    // Combine LineChanges inline + GitFileRow logic from files.tsx
    // Add optional checkbox for stage/unstage
    // Add optional onToggle callback
}
```

- [ ] **Step 2: Update files.tsx to import GitFileRow**

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SessionFiles/GitFileRow.tsx web/src/routes/sessions/files.tsx
git commit -m "refactor: extract GitFileRow into standalone component"
```

---

### Task 10: Create GitToolbar component

**Files:**
- Create: `web/src/components/SessionFiles/GitToolbar.tsx`

- [ ] **Step 1: Create GitToolbar.tsx**

```typescript
type GitToolbarProps = {
    onFetch: () => void
    onPull: () => void
    onPush: () => void
    onStash: () => void
    loading: 'fetch' | 'pull' | 'push' | null
    error: string | null
    onDismissError: () => void
}

export function GitToolbar({ onFetch, onPull, onPush, onStash, loading, error, onDismissError }: GitToolbarProps) {
    return (
        <div>
            {/* Toolbar row: 4 buttons with loading states */}
            {/* Error banner below if error is set */}
        </div>
    )
}
```

Buttons styled as compact pill buttons using existing CSS variables. Each button shows a spinner when its action is loading. Disabled state when any action is loading.

- [ ] **Step 2: Commit**

```bash
git add web/src/components/SessionFiles/GitToolbar.tsx
git commit -m "feat: add GitToolbar component"
```

---

## Chunk 4: Tab Components

### Task 11: Create ChangesTab component

**Files:**
- Create: `web/src/components/SessionFiles/ChangesTab.tsx`

- [ ] **Step 1: Create ChangesTab.tsx**

This is the largest new component. It combines:
- GitToolbar (fetch/pull/push/stash)
- Staged files section (collapsible, with checkboxes)
- Unstaged files section (collapsible, with checkboxes)
- Stage All / Unstage All buttons
- Inline commit input + button at bottom

Props:
```typescript
type ChangesTabProps = {
    api: ApiClient
    sessionId: string
    gitStatus: GitStatusFiles | null
    isLoading: boolean
    onOpenFile: (path: string, staged?: boolean) => void
    onRefresh: () => void
}
```

Key state:
- `commitMessage: string`
- `gitActionLoading: 'fetch' | 'pull' | 'push' | null`
- `gitActionError: string | null`
- `commitLoading: boolean`

Handlers: handleFetch, handlePull, handlePush, handleStage, handleUnstage, handleStageAll, handleUnstageAll, handleCommit, handleRollback, handleDiscard, handleOpenStash

The staged/unstaged sections are collapsible with chevron. Each file row uses GitFileRow with checkbox mode.

Bottom fixed area: Stage All / Unstage All row + commit message textarea + Commit button.

- [ ] **Step 2: Commit**

```bash
git add web/src/components/SessionFiles/ChangesTab.tsx
git commit -m "feat: add ChangesTab component"
```

---

### Task 12: Create CommitRow and HistoryTab components

**Files:**
- Create: `web/src/components/SessionFiles/CommitRow.tsx`
- Create: `web/src/components/SessionFiles/HistoryTab.tsx`

- [ ] **Step 1: Create CommitRow.tsx**

```typescript
import type { CommitEntry } from '@/types/api'

function formatRelativeTime(timestamp: number): string {
    const now = Date.now() / 1000
    const diff = now - timestamp
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
    return new Date(timestamp * 1000).toLocaleDateString()
}

export function CommitRow({ commit }: { commit: CommitEntry }) {
    return (
        <div className="flex items-start gap-3 py-2 px-4">
            {/* Left: timeline dot + vertical line */}
            <div className="flex flex-col items-center pt-1.5">
                <div className="w-2 h-2 rounded-full bg-[var(--app-link)]" />
                <div className="w-px flex-1 bg-[var(--app-border)]" />
            </div>
            {/* Right: commit info */}
            <div className="flex-1 min-w-0 pb-4">
                <div className="text-sm text-[var(--app-fg)] truncate">{commit.subject}</div>
                <div className="text-xs text-[var(--app-hint)] mt-0.5">
                    <span className="font-mono">{commit.short}</span>
                    <span className="mx-1">·</span>
                    <span>{commit.author}</span>
                    <span className="mx-1">·</span>
                    <span>{formatRelativeTime(commit.date)}</span>
                </div>
            </div>
        </div>
    )
}
```

- [ ] **Step 2: Create HistoryTab.tsx**

```typescript
import type { ApiClient } from '@/api/client'
import { useGitLog } from '@/hooks/queries/useGitLog'
import { CommitRow } from './CommitRow'

type HistoryTabProps = {
    api: ApiClient
    sessionId: string
}

export function HistoryTab({ api, sessionId }: HistoryTabProps) {
    const [allCommits, setAllCommits] = useState<CommitEntry[]>([])
    const [skip, setSkip] = useState(0)
    const [hasMore, setHasMore] = useState(true)
    const { commits, isLoading } = useGitLog(api, sessionId, { limit: 50, skip })
    const scrollRef = useRef<HTMLDivElement>(null)

    // Append new commits when loaded
    useEffect(() => {
        if (commits.length > 0) {
            setAllCommits(prev => skip === 0 ? commits : [...prev, ...commits])
            setHasMore(commits.length === 50)
        } else if (!isLoading) {
            setHasMore(false)
        }
    }, [commits, skip, isLoading])

    // Infinite scroll handler
    const handleScroll = useCallback(() => {
        const el = scrollRef.current
        if (!el || isLoading || !hasMore) return
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
            setSkip(allCommits.length)
        }
    }, [isLoading, hasMore, allCommits.length])

    return (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
            {allCommits.map(commit => (
                <CommitRow key={commit.hash} commit={commit} />
            ))}
            {isLoading && <LoadingSkeleton />}
            {!hasMore && allCommits.length > 0 && (
                <div className="text-center text-xs text-[var(--app-hint)] py-4">No more commits</div>
            )}
            {!isLoading && allCommits.length === 0 && (
                <div className="text-center text-sm text-[var(--app-hint)] py-8">No commit history</div>
            )}
        </div>
    )
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SessionFiles/CommitRow.tsx web/src/components/SessionFiles/HistoryTab.tsx
git commit -m "feat: add HistoryTab with infinite scroll commit timeline"
```

---

### Task 13: Create BranchesTab component

**Files:**
- Create: `web/src/components/SessionFiles/BranchesTab.tsx`

- [ ] **Step 1: Create BranchesTab.tsx**

Props:
```typescript
type BranchesTabProps = {
    api: ApiClient
    sessionId: string
    currentBranch: string | null
    onBranchChanged: () => void
}
```

Key state:
- `searchQuery: string` — filter branches
- `showCreateInput: boolean` — new branch form
- `newBranchName: string`
- `newBranchFrom: string`
- `actionLoading: string | null` — which branch action is loading

Sections:
1. Search input at top
2. Collapsible "Local (N)" section — filtered by search
3. Collapsible "Remote (N)" section — filtered by search
4. Fixed bottom: "+ New Branch" button

Branch row interactions:
- Tap local branch → `api.gitCheckout()` with confirmation if uncommitted changes
- Tap remote branch → `api.gitCheckout()` (creates local tracking branch)
- Current branch shows dot indicator, non-clickable

New branch form: inline input that appears above the bottom button when "+ New Branch" is tapped. Name field + optional "from" dropdown + Create button.

Uses `useGitBranches` hook.

- [ ] **Step 2: Commit**

```bash
git add web/src/components/SessionFiles/BranchesTab.tsx
git commit -m "feat: add BranchesTab with local/remote management"
```

---

### Task 14: Create StashSheet component

**Files:**
- Create: `web/src/components/SessionFiles/StashSheet.tsx`

- [ ] **Step 1: Create StashSheet.tsx**

Props:
```typescript
type StashSheetProps = {
    api: ApiClient
    sessionId: string
    open: boolean
    onClose: () => void
    onStashChanged: () => void
}
```

Layout: Bottom sheet overlay with backdrop. Contains:
1. Header: "Stash" + close button
2. Push section: optional message input + "Stash Changes" button
3. List section: stash entries with Pop button each
4. Empty state when no stashes

Uses `useGitStashList` hook. Calls `api.gitStash()` and `api.gitStashPop()`.

Sheet animation: slide up from bottom with backdrop fade. Dismiss on backdrop tap or × button.

- [ ] **Step 2: Commit**

```bash
git add web/src/components/SessionFiles/StashSheet.tsx
git commit -m "feat: add StashSheet bottom sheet component"
```

---

## Chunk 5: Rewire files.tsx + Cleanup

### Task 15: Rewrite files.tsx as route shell

**Files:**
- Modify: `web/src/routes/sessions/files.tsx`

- [ ] **Step 1: Update route search params**

Update the route's `validateSearch` to accept new tab values:
```typescript
tab: z.enum(['changes', 'history', 'branches', 'directories']).optional()
```

- [ ] **Step 2: Rewrite files.tsx**

Slim down files.tsx to ~100-150 lines. It becomes a thin route shell:

```typescript
// Imports: React, routing, hooks, tab components
import { ChangesTab } from '@/components/SessionFiles/ChangesTab'
import { HistoryTab } from '@/components/SessionFiles/HistoryTab'
import { BranchesTab } from '@/components/SessionFiles/BranchesTab'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'

// Route component:
// 1. Header: back button, "Git" title, current branch name, refresh button
// 2. Tab bar: Changes | History | Branches (3 visible tabs)
// 3. Tab content: render active tab component
// 4. Keep DirectoryTree for ?tab=directories (hidden tab, URL-only access)

// State: only activeTab + search params sync
// All git logic moved into tab components
```

Key changes:
- Remove all inline components (StatusBadge, LineChanges, GitFileRow, SearchResultRow, FileListSkeleton) — they're now in separate files
- Remove CommitDrawer usage — replaced by ChangesTab inline commit
- Remove git action handlers (fetch, pull, rollback) — moved to ChangesTab
- Remove commitOpen state — no longer needed
- Keep useGitStatusFiles for branch name in header
- Tab bar shows only 3 tabs, directories accessible via URL only

- [ ] **Step 3: Commit**

```bash
git add web/src/routes/sessions/files.tsx
git commit -m "refactor: slim files.tsx to route shell with 3-tab git workbench"
```

---

### Task 16: Deprecate CommitDrawer

**Files:**
- Modify: `web/src/components/SessionFiles/CommitDrawer.tsx`

- [ ] **Step 1: Add deprecation comment**

Add at top of CommitDrawer.tsx:
```typescript
/** @deprecated Use ChangesTab instead. Kept for reference during migration. */
```

No need to delete — it will be unused after files.tsx rewrite. Can be cleaned up later.

- [ ] **Step 2: Commit**

```bash
git add web/src/components/SessionFiles/CommitDrawer.tsx
git commit -m "chore: deprecate CommitDrawer (replaced by ChangesTab)"
```

---

### Task 17: Final verification

- [ ] **Step 1: Run type check**

```bash
cd /home/hwwwww/Project/hapi/web && npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Run tests**

```bash
cd /home/hwwwww/Project/hapi/web && npx vitest --run
```

Fix any test failures.

- [ ] **Step 3: Run build**

```bash
cd /home/hwwwww/Project/hapi/web && npm run build
```

Ensure clean build.

- [ ] **Step 4: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: address type errors and test failures from git workbench refactor"
```
