# Git Workbench UI Redesign

## Overview

Redesign the frontend git page from a "file manager with git features" into a dedicated Git Workbench. Mobile-first, touch-optimized, centered around git workflows.

## Core Decisions

- **Positioning**: Git Workbench — git operations are first-class citizens
- **Tab structure**: 3 Tabs — `Changes` | `History` | `Branches`
- **Stash**: Bottom sheet triggered from Changes toolbar
- **Mobile-first**: All interactions touch-optimized, max-width 720px preserved
- **Directories tab**: Retained as hidden 4th tab (URL-accessible, not in tab bar)

## Page Layout

```
┌──────────────────────────────────────┐
│ Header: ← Back  "Git"  [branch] ↻   │
├──────────────────────────────────────┤
│ Tab Bar: Changes | History | Branches│
├──────────────────────────────────────┤
│ Tab Content (scrollable)             │
├──────────────────────────────────────┤
│ Action Bar (fixed bottom, per-tab)   │
└──────────────────────────────────────┘
```

Header shows current branch name inline (replaces old BranchSwitcher in status bar).

## Tab 1: Changes

### Layout
```
┌──────────────────────────────────────┐
│ Toolbar: [Fetch] [Pull] [Push] [Stash]│
│ Error banner (if any)                │
├──────────────────────────────────────┤
│ ▼ Staged Changes (N)                 │
│   ☑ M src/app.ts          +12 -3    │
│   ☑ A src/new.ts          +45       │
├──────────────────────────────────────┤
│ ▼ Unstaged Changes (N)              │
│   ☐ M src/utils.ts        +2  -1   │
│   ☐ ? untracked.ts                  │
├──────────────────────────────────────┤
│ Fixed Bottom:                        │
│ [Stage All] [Unstage All]            │
│ [commit message input] [Commit btn]  │
└──────────────────────────────────────┘
```

### Interactions
- Tap file row → open diff detail page (existing `/file` route)
- Checkbox → stage/unstage single file
- Swipe left on file → Discard Changes / Rollback action
- Stage All / Unstage All → batch operation
- Commit input + button inline at bottom (no drawer)
- Toolbar buttons: Fetch, Pull, Push with loading states
- Stash button → opens StashSheet

### Data
- Reuses existing `useGitStatusFiles` hook
- Checkbox stage/unstage uses existing `gitStage(sessionId, filePath, boolean)` API
- Fetch/Pull/Push call existing API client methods
- `gitActionLoading` state extended to `'fetch' | 'pull' | 'push' | null`
- Discard uses `gitDiscardChanges`, Rollback uses `gitRollbackFile`

## Tab 2: History (NEW)

### Layout
```
┌──────────────────────────────────────┐
│ Commit list (linear timeline)        │
│                                      │
│ ● abc1234  feat: add login page      │
│ │ John · 2 hours ago                 │
│ │                                    │
│ ● def5678  fix: button alignment     │
│ │ Jane · 5 hours ago                 │
│ │                                    │
│ ... (infinite scroll)                │
└──────────────────────────────────────┘
```

### Interactions
- Infinite scroll: load 50 commits per page, fetch more on scroll
- Tap commit → expand inline to show subject (already in data, no extra API call)
- Left vertical line connects commit dots (simple linear timeline)
- No action bar needed

### Data
- New `useGitLog` hook with pagination support
- Requires enhanced `git-log` CLI handler format:
  `git log --format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s -n <limit> --skip=<offset>`
  (Uses NUL byte `%x00` as field separator to avoid conflicts with commit messages)
- New `parseGitLog()` function in gitParsers.ts

### Git Log Format
```
Fields separated by NUL byte (\0):
- %H: full hash
- %h: short hash
- %an: author name
- %ae: author email
- %at: author date (unix timestamp)
- %s: subject line
Lines separated by newline. Each line = one commit.
```

## Tab 3: Branches

### Layout
```
┌──────────────────────────────────────┐
│ Search: Filter branches...           │
├──────────────────────────────────────┤
│ ▼ Local (N)                          │
│   ● main                  ← current │
│     dev-feature                      │
│     fix-bug-123                      │
├──────────────────────────────────────┤
│ ▼ Remote (N)                         │
│     origin/main                      │
│     origin/dev                       │
├──────────────────────────────────────┤
│ Fixed Bottom: [+ New Branch]         │
└──────────────────────────────────────┘
```

### Interactions
- Tap local branch → checkout (with confirmation if uncommitted changes)
- Swipe left on local branch → Delete / Merge into current
  - Merge conflict: show error banner + guide user to Changes tab to see conflicted files
- Tap remote branch → checkout as local tracking branch
- New Branch button → inline input (name + optional "from" branch)
- Search filters both local and remote lists
- Current branch highlighted with dot indicator

### Data
- New `useGitBranches` hook (fetches both local + remote)
- Uses `gitCheckout`, `gitCreateBranch`, `gitDeleteBranch`, `gitMerge`
- Uses `gitRemoteBranches` for remote list

## Stash Sheet (Bottom Sheet)

### Layout
```
┌──────────────────────────────────────┐
│ Stash                          [×]   │
├──────────────────────────────────────┤
│ [message input (optional)] [Stash]   │
├──────────────────────────────────────┤
│ stash@{0}: WIP on main        [Pop]  │
│ stash@{1}: temp save           [Pop]  │
│ (empty state if no stashes)          │
└──────────────────────────────────────┘
```

### Interactions
- Stash button: save current changes with optional message
- Pop button: apply and remove stash entry
- V1 scope: only Stash Push and Pop. Apply (without remove) and Drop (remove without apply) deferred to V2.
- Sheet dismisses on backdrop tap or × button

### Data
- New `useGitStashList` hook
- Uses `gitStash`, `gitStashPop`, `gitStashList`

## Route Changes

```
Before: /sessions/:sessionId/files?tab=changes|directories
After:  /sessions/:sessionId/files?tab=changes|history|branches|directories
```

Default tab remains `changes`. `directories` tab preserved but hidden from tab bar.

Route search params validation schema in TanStack Router route definition must be updated to accept the new tab values.

## Component Architecture

### New Components
| Component | File | Responsibility |
|:---|:---|:---|
| ChangesTab | `components/SessionFiles/ChangesTab.tsx` | Staged/unstaged file lists, commit input |
| HistoryTab | `components/SessionFiles/HistoryTab.tsx` | Commit history timeline |
| BranchesTab | `components/SessionFiles/BranchesTab.tsx` | Branch management (local + remote) |
| StashSheet | `components/SessionFiles/StashSheet.tsx` | Stash bottom sheet |
| GitToolbar | `components/SessionFiles/GitToolbar.tsx` | Fetch/Pull/Push/Stash buttons |
| CommitRow | `components/SessionFiles/CommitRow.tsx` | Single commit display |
| GitFileRow | `components/SessionFiles/GitFileRow.tsx` | Extracted from files.tsx |
| StatusBadge | `components/SessionFiles/StatusBadge.tsx` | Extracted from files.tsx |

### Refactored Components
| Component | Change |
|:---|:---|
| `files.tsx` | Slim down to route shell + tab switching only (~100 lines) |
| `CommitDrawer.tsx` | Deprecated, logic absorbed into ChangesTab |
| `BranchSwitcher.tsx` | Simplified to header-only branch display |

### New Hooks
| Hook | File | Purpose |
|:---|:---|:---|
| `useGitLog` | `hooks/queries/useGitLog.ts` | Paginated commit history |
| `useGitBranches` | `hooks/queries/useGitBranches.ts` | Local + remote branches |
| `useGitStashList` | `hooks/queries/useGitStashList.ts` | Stash entries |

### New Parser Functions
| Function | Purpose |
|:---|:---|
| `parseGitLog(stdout)` | Parse NUL-delimited log output into CommitEntry[] |

## CLI Handler Changes

### git-log Enhancement
Current: `git log --oneline -n <limit>`
New: `git log --format=%H%x00%h%x00%an%x00%ae%x00%at%x00%s -n <limit> --skip=<offset>`

Add `skip` parameter across all layers:
- CLI handler: add `skip` to request type, append `--skip=<offset>` to git args
- RPC Gateway: add `skip` to options type
- SyncEngine: add `skip` to options type
- Hub route: add `skip` to query/body schema (GET param for git-log)
- API client: add `skip` parameter to `gitLog()` method

## Types

```typescript
type CommitEntry = {
    hash: string        // full SHA
    short: string       // short SHA
    author: string      // author name
    email: string       // author email
    date: number        // unix timestamp
    subject: string     // commit subject line
}

type GitBranchEntry = {
    name: string
    isCurrent: boolean
    isRemote: boolean
}

type StashEntry = {
    index: number
    message: string
}
```

## Styling

- Follow existing CSS variable system (--app-git-*, --app-diff-*, etc.)
- Tailwind CSS classes consistent with current codebase
- Dark mode support via existing [data-theme="dark"] system
- Touch targets minimum 44px height for mobile
- Swipe actions via CSS transforms (no external gesture library)

## Error Handling

- Each git operation shows inline error banner (dismissible)
- Network errors show "Session not connected" state
- Optimistic UI for stage/unstage (revert on failure)
- Loading skeletons for initial data fetch
