# Session Native Time Semantics Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native and hybrid session `createdAt` come from authoritative native creation time, and make `updatedAt` equal the last message time instead of metadata/sync bookkeeping time.

**Architecture:** Push authoritative timestamps from CLI native providers into the native upsert contract, then let hub store/sync logic reconcile session timestamps centrally. Only message paths and explicit timestamp reconciliation are allowed to modify session recency fields; metadata, agent-state, todos, and sync-state writes must stop polluting `updatedAt`.

**Tech Stack:** Bun workspaces, TypeScript strict, Bun SQLite, Hono, Vitest.

---

## File Structure

### Existing files to modify
- `cli/src/nativeSync/types.ts`
  - Replace summary-level discovery time semantics with explicit `createdAt` + `lastActivityAt`.
- `cli/src/nativeSync/providers/claude.ts`
  - Derive authoritative Claude session times from native event chronology.
- `cli/src/nativeSync/providers/codex.ts`
  - Derive authoritative Codex session times from `session_meta` + event chronology.
- `cli/src/nativeSync/NativeSyncService.ts`
  - Send explicit timestamp fields in native upsert payloads.
- `cli/src/api/api.ts`
  - Add timestamp fields to the native upsert request contract.
- `cli/src/nativeSync/NativeSyncService.test.ts`
  - Lock the new upsert contract and service behavior.
- `cli/src/nativeSync/providers/claude.test.ts`
  - Lock Claude `createdAt`/`lastActivityAt` extraction.
- `cli/src/nativeSync/providers/codex.test.ts`
  - Lock Codex `createdAt`/`lastActivityAt` extraction.
- `hub/src/web/routes/cliNative.ts`
  - Require/validate `createdAt` and `lastActivityAt` on native session upsert.
- `hub/src/web/routes/cliNative.test.ts`
  - Verify route validation and timestamp propagation.
- `hub/src/store/sessions.ts`
  - Add session timestamp reconciliation and stop non-message writes from touching `updated_at`.
- `hub/src/store/sessionStore.ts`
  - Expose timestamp reconciliation.
- `hub/src/store/messages.ts`
  - Keep message writes authoritative for recency; native import will reconcile after batch.
- `hub/src/store/messages.nativeImport.test.ts`
  - Lock imported message chronology behavior.
- `hub/src/sync/syncEngine.ts`
  - Thread timestamp fields through native upsert/import reconciliation.
- `hub/src/sync/nativeSync.integration.test.ts`
  - Verify end-to-end created/update time semantics after first sync.
- `hub/src/sync/nativeImportResume.test.ts`
  - Verify hybrid sessions still preserve correct recency semantics.

### New files to create
- `hub/src/store/sessions.timeSemantics.test.ts`
  - Focused store tests for reconciliation and non-message-write behavior.

### Constraints
- No compatibility path for old DB rows; assume rebuild/first sync.
- Do not add migrations or repair jobs.
- Provider `createdAt` is authoritative for native/hybrid session creation time.
- `updatedAt` must come from last message time when messages exist.
- No API-layer “derived-on-read” workaround.

## Chunk 1: Provider and ingest contract

### Task 1: Lock provider timestamp extraction with failing tests

**Files:**
- Modify: `cli/src/nativeSync/providers/claude.test.ts`
- Modify: `cli/src/nativeSync/providers/codex.test.ts`
- Modify: `cli/src/nativeSync/providers/claude.ts`
- Modify: `cli/src/nativeSync/providers/codex.ts`
- Modify: `cli/src/nativeSync/types.ts`

- [ ] **Step 1: Add a failing Claude provider test for authoritative chronology**

Add/extend a test that asserts:
- `summary.createdAt` equals the first parseable native event timestamp
- `summary.lastActivityAt` equals the last parseable native event timestamp
- file `mtime` is only fallback, not `Math.max(...)` inflation
- if `createdAt` cannot be read from events, fallback is `birthtime`, then `mtime`
- if `lastActivityAt` cannot be read from events, fallback is `mtime`
- if derived `lastActivityAt < createdAt`, the provider clamps `lastActivityAt = createdAt`

Example assertion:

```ts
expect(summary.createdAt).toBe(Date.parse('2026-03-15T00:00:00.000Z'))
expect(summary.lastActivityAt).toBe(Date.parse('2026-03-15T00:00:01.000Z'))
```

- [ ] **Step 2: Add a failing Codex provider test for `session_meta.payload.timestamp`**

Add/extend a test that asserts:
- `summary.createdAt` prefers `session_meta.payload.timestamp`
- `summary.lastActivityAt` prefers the last non-`session_meta` event timestamp
- if no non-`session_meta` event timestamp exists, fallback is `session_meta.payload.timestamp`
- if `createdAt` cannot be read from `session_meta` or events, fallback is `birthtime`, then `mtime`
- if `lastActivityAt` cannot be read from non-`session_meta` events or `session_meta.payload.timestamp`, fallback is `mtime`
- if derived `lastActivityAt < createdAt`, the provider clamps `lastActivityAt = createdAt`

- [ ] **Step 3: Run provider tests and watch them fail for the right reason**

Run:

```bash
bun test cli/src/nativeSync/providers/claude.test.ts cli/src/nativeSync/providers/codex.test.ts
```

Expected: FAIL because `NativeSessionSummary`/provider outputs still expose old discovery-time behavior.

- [ ] **Step 4: Implement the minimal provider/type changes**

Change `NativeSessionSummary` to:

```ts
export type NativeSessionSummary = {
    provider: NativeProviderName
    nativeSessionId: string
    projectPath: string
    displayPath: string
    flavor: 'claude' | 'codex'
    createdAt: number
    lastActivityAt: number
    title?: string
}
```

Then update Claude/Codex providers to emit:
- Claude: `createdAt = first event || birthtime || mtime`, `lastActivityAt = last event || mtime`
- Codex: `createdAt = session_meta.payload.timestamp || first event || birthtime || mtime`, `lastActivityAt = last non-session_meta event || session_meta.payload.timestamp || mtime`
- Clamp `lastActivityAt` to at least `createdAt`

- [ ] **Step 5: Re-run provider tests and make them green**

Run:

```bash
bun test cli/src/nativeSync/providers/claude.test.ts cli/src/nativeSync/providers/codex.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add cli/src/nativeSync/types.ts cli/src/nativeSync/providers/claude.ts cli/src/nativeSync/providers/codex.ts cli/src/nativeSync/providers/claude.test.ts cli/src/nativeSync/providers/codex.test.ts
git commit -m "fix(cli): derive native session timestamps from native chronology"
```

### Task 2: Make native upsert carry explicit timestamps across the CLI and route contract

**Files:**
- Modify: `cli/src/nativeSync/NativeSyncService.test.ts`
- Modify: `cli/src/nativeSync/NativeSyncService.ts`
- Modify: `cli/src/api/api.ts`
- Modify: `hub/src/web/routes/cliNative.ts`
- Modify: `hub/src/web/routes/cliNative.test.ts`

- [ ] **Step 1: Add a failing service test for the new upsert payload**

Assert `api.upsertNativeSession(...)` receives:

```ts
expect(api.upsertNativeSession).toHaveBeenCalledWith(expect.objectContaining({
    tag: buildStableNativeTag(summary),
    createdAt: summary.createdAt,
    lastActivityAt: summary.lastActivityAt,
}))
```

- [ ] **Step 2: Add a failing route test for timestamp validation**

POST `/cli/native/sessions/upsert` without `createdAt` or `lastActivityAt`, and with invalid numbers.

Expected:
- missing/invalid fields => `400`
- valid fields => `200`

Explicit invalid cases:
- missing `createdAt`
- missing `lastActivityAt`
- `Number.NaN` / `Infinity`
- `<= 0`
- `lastActivityAt < createdAt`

- [ ] **Step 3: Run the focused tests and watch them fail**

Run:

```bash
bun test cli/src/nativeSync/NativeSyncService.test.ts hub/src/web/routes/cliNative.test.ts
```

Expected: FAIL because native upsert still only accepts `tag/metadata/agentState`.

- [ ] **Step 4: Implement the contract change minimally**

Update CLI API types/calls and route schema so native upsert requires:

```ts
{
    tag: string,
    metadata: Metadata,
    createdAt: number,
    lastActivityAt: number,
    agentState?: AgentState | null,
}
```

Validation rules at the route boundary:
- finite numbers only
- `> 0`
- `lastActivityAt >= createdAt`

- [ ] **Step 5: Re-run the focused tests**

Run:

```bash
bun test cli/src/nativeSync/NativeSyncService.test.ts hub/src/web/routes/cliNative.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add cli/src/nativeSync/NativeSyncService.ts cli/src/nativeSync/NativeSyncService.test.ts cli/src/api/api.ts hub/src/web/routes/cliNative.ts hub/src/web/routes/cliNative.test.ts
git commit -m "fix(sync): send authoritative native session timestamps"
```

## Chunk 2: Hub timestamp reconciliation and non-message cleanup

### Task 3: Add store-level timestamp reconciliation first

**Files:**
- Create: `hub/src/store/sessions.timeSemantics.test.ts`
- Modify: `hub/src/store/sessions.ts`
- Modify: `hub/src/store/sessionStore.ts`
- Modify: `hub/src/store/messages.nativeImport.test.ts`

- [ ] **Step 1: Write failing store tests for timestamp semantics**

Cover these cases in `hub/src/store/sessions.timeSemantics.test.ts`:
- native session with no messages => `createdAt = provider createdAt`, `updatedAt = provider lastActivityAt`
- session with imported messages => `updatedAt = last message createdAt`
- later native upsert with earlier provider `createdAt` => `createdAt` moves earlier
- repeated reconciliation with the same payload is idempotent, including unchanged `seq`
- reconciliation enforces `updatedAt >= createdAt`
- metadata/agent-state/todo/team-state writes do not change session recency
- alias synchronization does not change session recency
- sync-state writes do not change session recency

Suggested skeleton:

```ts
const session = store.sessions.getOrCreateSession('tag', { path: '/tmp/project', host: 'local' }, null, 'default')
store.sessions.reconcileSessionTimestamps(session.id, 'default', {
    createdAt: 100,
    lastActivityAt: 150,
})
expect(store.sessions.getSession(session.id)).toEqual(expect.objectContaining({
    createdAt: 100,
    updatedAt: 150,
}))
```

- [ ] **Step 2: Run the new/focused store tests and watch them fail**

Run:

```bash
bun test hub/src/store/sessions.timeSemantics.test.ts hub/src/store/messages.nativeImport.test.ts
```

Expected: FAIL because no reconciliation API exists and non-message writes still mutate `updated_at`.

- [ ] **Step 3: Implement `reconcileSessionTimestamps(...)` minimally**

Add a store helper shaped like:

```ts
reconcileSessionTimestamps(sessionId, namespace, {
    createdAt,
    lastActivityAt,
})
```

Implementation rules:
- query `MAX(messages.created_at)` for the session
- set `sessions.created_at = candidate createdAt`
- set `sessions.updated_at = maxMessageCreatedAt ?? lastActivityAt ?? createdAt`
- clamp `updated_at` to at least `created_at`
- increment `seq` only when `created_at` or `updated_at` actually changes
- return the refreshed stored session row

- [ ] **Step 4: Remove non-message `updated_at` pollution**

In `hub/src/store/sessions.ts`, stop these methods from changing `updated_at`:
- `updateSessionMetadata(...)`
- `updateSessionAgentState(...)`
- `setSessionTodos(...)`
- `setSessionTeamState(...)`

Keep their own version/update guards intact; only session recency semantics change.

If the alias-recency regression test fails, make `syncNativeAliasesForSessionMetadata(...)` explicitly session-table-neutral as part of this task; do not defer alias semantics to a later chunk.

- [ ] **Step 5: Re-run the focused store tests**

Run:

```bash
bun test hub/src/store/sessions.timeSemantics.test.ts hub/src/store/messages.nativeImport.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add hub/src/store/sessions.ts hub/src/store/sessionStore.ts hub/src/store/messages.nativeImport.test.ts hub/src/store/sessions.timeSemantics.test.ts
git commit -m "fix(hub): reconcile session timestamps from native truth"
```

### Task 4: Thread reconciliation through sync/message paths

**Files:**
- Modify: `hub/src/store/messages.ts`
- Modify: `hub/src/sync/syncEngine.ts`
- Modify: `hub/src/sync/nativeSync.integration.test.ts`
- Modify: `hub/src/sync/nativeImportResume.test.ts`
- Modify: `hub/src/web/routes/cliNative.test.ts`

- [ ] **Step 1: Write failing integration assertions for real session times**

Extend `hub/src/sync/nativeSync.integration.test.ts` so after first sync:

```ts
expect(session.createdAt).toBe(Date.parse('2026-03-15T00:00:00.000Z'))
expect(session.updatedAt).toBe(Date.parse('2026-03-15T00:00:02.000Z'))
```

Also add a no-message case:

```ts
expect(session.updatedAt).toBe(summary.lastActivityAt)
```

- [ ] **Step 2: Add a failing hybrid regression test**

In `hub/src/sync/nativeImportResume.test.ts`, assert that after a session becomes hybrid, metadata churn / native re-upsert does not move `updatedAt` away from the last message timestamp.

Also extend `hub/src/web/routes/cliNative.test.ts` with an explicit bookkeeping regression:

```ts
const before = engine.getSession(sessionId)?.updatedAt
await postSyncState(...)
expect(engine.getSession(sessionId)?.updatedAt).toBe(before)
```

This covers sync-state writes staying out of recency semantics.

- [ ] **Step 3: Run the focused sync tests and watch them fail**

Run:

```bash
bun test hub/src/sync/nativeSync.integration.test.ts hub/src/sync/nativeImportResume.test.ts
```

and

```bash
bun test hub/src/web/routes/cliNative.test.ts
```

Expected: FAIL because native upsert/import does not yet reconcile authoritative session timestamps and the new sync-state recency regression test should fail first.

- [ ] **Step 4: Implement the minimal sync changes**

In `hub/src/sync/syncEngine.ts`:
- extend `upsertNativeSession(...)` payload to accept `createdAt` and `lastActivityAt`
- immediately call `store.sessions.reconcileSessionTimestamps(...)` after canonical session resolution
- after `importNativeMessages(...)`, reconcile again using the same authoritative native times (from payload/current metadata)
- keep `updateNativeSyncState(...)` on `touchUpdatedAt: false`; add no new session-recency writes there
- preserve existing hybrid suppression of duplicate native re-imports

In `hub/src/store/messages.ts`:
- keep live `addMessage(...)` updating `updated_at` from the new message timestamp
- do not rely on `touchSessionUpdatedAt(...)` alone for native correctness; reconciliation is the source of truth after import batches

- [ ] **Step 5: Re-run the focused sync tests**

Run:

```bash
bun test hub/src/sync/nativeSync.integration.test.ts hub/src/sync/nativeImportResume.test.ts
```

and

```bash
bun test hub/src/web/routes/cliNative.test.ts
```

Expected: PASS, including the sync-state/bookkeeping recency regression.

- [ ] **Step 6: Run a broader regression bundle**

Run:

```bash
bun test cli/src/nativeSync/providers/claude.test.ts cli/src/nativeSync/providers/codex.test.ts cli/src/nativeSync/NativeSyncService.test.ts hub/src/web/routes/cliNative.test.ts hub/src/store/messages.nativeImport.test.ts hub/src/store/sessions.timeSemantics.test.ts hub/src/sync/nativeSync.integration.test.ts hub/src/sync/nativeImportResume.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add hub/src/store/messages.ts hub/src/sync/syncEngine.ts hub/src/sync/nativeSync.integration.test.ts hub/src/sync/nativeImportResume.test.ts hub/src/web/routes/cliNative.test.ts
git commit -m "fix(hub): keep session recency tied to real message times"
```

## Chunk 3: Final verification

### Task 5: Typecheck and repo-level verification

**Files:**
- No new files; verification only.

- [ ] **Step 1: Run typecheck**

Run:

```bash
bun typecheck
```

Expected: PASS

- [ ] **Step 2: Run the default test suite used by the repo**

Run:

```bash
bun run test
```

Expected: PASS

- [ ] **Step 3: Re-run route validation coverage**

Run:

```bash
bun test hub/src/web/routes/cliNative.test.ts
```

Expected: PASS, including coverage for missing fields, non-finite values, `<= 0`, and `lastActivityAt < createdAt`.

- [ ] **Step 4: Re-run store semantics coverage**

Run:

```bash
bun test hub/src/store/sessions.timeSemantics.test.ts
```

Expected: PASS, including:
- no-message `updatedAt = lastActivityAt`
- earlier provider `createdAt` overwrite
- idempotent reconciliation
- alias/sync-state/bookkeeping writes do not change recency

- [ ] **Step 5: Re-run integration coverage for native/hybrid flows**

Run:

```bash
bun test hub/src/sync/nativeSync.integration.test.ts hub/src/sync/nativeImportResume.test.ts
```

Expected: PASS, including:
- first-sync `createdAt`/`updatedAt` correctness
- hybrid sessions keep `updatedAt` tied to last message

- [ ] **Step 6: Verify working tree state before any optional final commit**

Run:

```bash
git status --short
```

Expected:
- only intended implementation files are modified
- if no extra cleanup was needed, no final commit is required
- if a final cleanup commit is needed, commit only explicit files with an explicit message
