# Git Operations Expansion Design

## Overview

Expand git operation coverage from 9 existing operations to 20, covering all fundamental daily git workflows.

## Current State

Existing operations: `status`, `diff-numstat`, `diff-file`, `branches`, `checkout`, `stage`, `commit`, `pull`, `fetch`, `rollback-file` (API only, CLI not implemented).

## New Operations

| Operation | RPC Method | HTTP Route | Method | Git Command | Timeout |
|:---|:---|:---|:---|:---|:---|
| Push | `git-push` | `POST /sessions/:id/git-push` | POST | `git push [remote] [branch]` | 60s |
| Log | `git-log` | `GET /sessions/:id/git-log` | GET | `git log --oneline -n <limit>` | 10s |
| Create Branch | `git-create-branch` | `POST /sessions/:id/git-create-branch` | POST | `git checkout -b <name> [from]` | 10s |
| Delete Branch | `git-delete-branch` | `POST /sessions/:id/git-delete-branch` | POST | `git branch -d <name>` | 10s |
| Stash | `git-stash` | `POST /sessions/:id/git-stash` | POST | `git stash [push -m <msg>]` | 10s |
| Stash Pop | `git-stash-pop` | `POST /sessions/:id/git-stash-pop` | POST | `git stash pop [index]` | 10s |
| Stash List | `git-stash-list` | `GET /sessions/:id/git-stash-list` | GET | `git stash list` | 10s |
| Merge | `git-merge` | `POST /sessions/:id/git-merge` | POST | `git merge <branch>` | 30s |
| Discard Changes | `git-discard-changes` | `POST /sessions/:id/git-discard-changes` | POST | `git checkout -- <file>` | 10s |
| Remote Branches | `git-remote-branches` | `GET /sessions/:id/git-remote-branches` | GET | `git branch -r --format=%(refname:short)` | 10s |
| Rollback File (fix) | `git-rollback-file` | existing | POST | `git checkout HEAD -- <file>` | 10s |

## Architecture

Follows existing 4-layer RPC pattern:

```
CLI Handler (git.ts) → RPC Gateway → SyncEngine → Hub Route → API Client
```

No new files needed. All changes are additive to existing files.

## Files Modified

1. `cli/src/modules/common/handlers/git.ts` — register new RPC handlers
2. `hub/src/sync/rpcGateway.ts` — add gateway methods
3. `hub/src/sync/syncEngine.ts` — add engine methods
4. `hub/src/web/routes/git.ts` — add HTTP routes + Zod schemas
5. `web/src/api/client.ts` — add API client methods

## Security

- All file paths validated via existing `validatePath()`
- All operations scoped to session working directory
- Appropriate timeouts for network operations (push/merge: 30-60s)

## Request/Response Schemas

All new operations use the existing `GitCommandResponse` type. Input schemas:

- `git-push`: `{ remote?: string, branch?: string }`
- `git-log`: `{ limit?: number }` (default 50, max 500)
- `git-create-branch`: `{ name: string, from?: string }`
- `git-delete-branch`: `{ name: string, force?: boolean }`
- `git-stash`: `{ message?: string }`
- `git-stash-pop`: `{ index?: number }`
- `git-stash-list`: (no params)
- `git-merge`: `{ branch: string }`
- `git-discard-changes`: `{ filePath: string }`
- `git-remote-branches`: (no params)
