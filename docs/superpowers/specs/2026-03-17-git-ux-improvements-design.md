# Git UX Improvements Design

Date: 2026-03-17

## Overview

Three improvements to the Files page git experience:
1. Branch switching with conflict detection
2. Directory tree expanded-state persistence
3. File commit support (stage/unstage + commit message)

---

## Feature 1: Branch Switching

### User Flow

1. Files page (Changes tab) shows current branch with a switch button beside it
2. Click button → fetch branch list → show branch picker overlay
3. Select branch → check for uncommitted changes
4. If changes exist → show warning dialog: "You have uncommitted changes. Please commit or stash them before switching branches."
5. No changes → execute `git checkout <branch>` → refresh git status
6. On checkout failure → show stderr error message inline

### New RPC Handlers (CLI)

**`git-branches`**
```
git branch -a --format=%(refname:short)
```
Returns: `{ success, stdout }` — newline-separated branch names

**`git-checkout`**
```
git checkout <branch>
```
Returns: `{ success, stdout, stderr, exitCode }`

### New API Routes (Hub)

- `GET /sessions/:id/git-branches` → calls `engine.getGitBranches(sessionId, sessionPath)`
- `POST /sessions/:id/git-checkout` body: `{ branch: string }` → calls `engine.gitCheckout(...)`

### Frontend Components

- `BranchSwitcher` component in `web/src/components/SessionFiles/BranchSwitcher.tsx`
  - Props: `api`, `sessionId`, `currentBranch`, `hasUncommittedChanges`, `onSwitched`
  - State: `open`, `branches`, `loading`, `error`
- Rendered in `files.tsx` beside the branch label in the git status bar

### Conflict Guard Logic

```
if (gitStatus.totalStaged > 0 || gitStatus.totalUnstaged > 0) {
  show warning → block switch
} else {
  proceed with checkout
}
```

---

## Feature 2: Directory Tree Expanded-State Persistence

### Approach

Persist expanded folder paths in URL search params (`expanded` key, comma-separated).

### URL Format

```
/sessions/:id/files?tab=directories&expanded=src,src/components,src/hooks
```

### Changes

**`DirectoryTree` component** — add props:
```ts
expandedPaths: string[]
onExpandedChange: (paths: string[]) => void
```
Remove internal `useState` for `expanded`; derive `Set<string>` from props.

**`FilesPage`** — read/write `expanded` from URL search:
```ts
const search = useSearch({ from: '/sessions/$sessionId/files' })
const expandedPaths = useMemo(
  () => search.expanded ? search.expanded.split(',').filter(Boolean) : [''],
  [search.expanded]
)
const handleExpandedChange = useCallback((paths: string[]) => {
  navigate({ search: (prev) => ({ ...prev, expanded: paths.join(',') }), replace: true })
}, [navigate])
```

**Router schema** — add `expanded?: string` to the files route search schema.

---

## Feature 3: File Commit

### User Flow

1. Changes tab shows a "Commit" button in the git status bar (enabled when staged files > 0)
2. Click → slide-up bottom drawer opens
3. Drawer contains:
   - File list with checkboxes (checked = staged, unchecked = unstaged)
   - Commit message textarea
   - "Commit" button (disabled when message empty)
4. Toggle checkbox → `git add <file>` or `git restore --staged <file>` → refresh file list
5. Submit → `git commit -m "<message>"` → close drawer → refresh git status

### New RPC Handlers (CLI)

**`git-stage`**
```ts
interface GitStageRequest { cwd?: string; filePath: string; stage: boolean }
```
- `stage: true` → `git add <filePath>`
- `stage: false` → `git restore --staged <filePath>`

**`git-commit`**
```ts
interface GitCommitRequest { cwd?: string; message: string }
```
→ `git commit -m "<message>"`

### New API Routes (Hub)

- `POST /sessions/:id/git-stage` body: `{ filePath, stage }` → `engine.gitStage(...)`
- `POST /sessions/:id/git-commit` body: `{ message }` → `engine.gitCommit(...)`

### Frontend Components

**`CommitDrawer`** in `web/src/components/SessionFiles/CommitDrawer.tsx`
- Props: `api`, `sessionId`, `gitStatus`, `onCommitted`, `onClose`
- State: `message`, `isPending`
- File list derived from `gitStatus.stagedFiles + gitStatus.unstagedFiles`
- Checkbox state reflects `isStaged` on each file

**Integration in `files.tsx`**:
- Add `commitOpen` state
- "Commit" button in git status bar → `setCommitOpen(true)`
- Render `<CommitDrawer>` conditionally

### New API Client Methods

```ts
async gitBranches(sessionId: string): Promise<GitCommandResponse>
async gitCheckout(sessionId: string, branch: string): Promise<GitCommandResponse>
async gitStage(sessionId: string, filePath: string, stage: boolean): Promise<GitCommandResponse>
async gitCommit(sessionId: string, message: string): Promise<GitCommandResponse>
```

---

## File Change Summary

| File | Change |
|------|--------|
| `cli/src/modules/common/handlers/git.ts` | Add `git-branches`, `git-checkout`, `git-stage`, `git-commit` handlers |
| `hub/src/sync/rpcGateway.ts` | Add 4 new RPC gateway methods |
| `hub/src/sync/syncEngine.ts` | Expose 4 new methods |
| `hub/src/web/routes/git.ts` | Add 4 new routes |
| `web/src/api/client.ts` | Add 4 new API client methods |
| `web/src/types/api.ts` | Add response types if needed |
| `web/src/router.tsx` | Add `expanded` to files route search schema |
| `web/src/components/SessionFiles/DirectoryTree.tsx` | Controlled expanded state via props |
| `web/src/components/SessionFiles/BranchSwitcher.tsx` | New component |
| `web/src/components/SessionFiles/CommitDrawer.tsx` | New component |
| `web/src/routes/sessions/files.tsx` | Wire up all three features |
