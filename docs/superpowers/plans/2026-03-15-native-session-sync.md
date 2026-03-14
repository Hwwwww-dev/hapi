# Native Claude/Codex Session Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HAPI discover, mirror, and continuously sync real native Claude Code and Codex sessions created outside HAPI, while keeping SQLite as the existing web read model and preserving resume/takeover flows.

**Architecture:** Add a machine-scoped native sync service that runs alongside the runner, scans native Claude/Codex storage, maps each native session to one canonical HAPI session via a stable tag, and imports history/increments into hub SQLite through authenticated CLI-only ingest endpoints. Keep the existing web/session/message APIs and SSE flow intact by treating SQLite as a materialized read model rather than replacing it.

**Tech Stack:** Bun workspaces, TypeScript strict, Bun SQLite, Hono, Socket.IO, runner daemon, Vitest.

---

## File Structure

### Existing files to modify
- `shared/src/schemas.ts`
  - Extend metadata with native source markers and sync timestamps used by both hub and CLI.
- `hub/src/store/index.ts`
  - Add message source columns/indexes and create the `native_sync_state` table + migration.
- `hub/src/store/types.ts`
  - Add stored native sync state and stored message source fields.
- `hub/src/store/messages.ts`
  - Add idempotent native-message insert/read helpers keyed by native source fields.
- `hub/src/store/messageStore.ts`
  - Expose native import methods to higher layers.
- `hub/src/store/sessionStore.ts`
  - Reuse stable tags and expose any tiny helper needed by native import flow.
- `hub/src/sync/syncEngine.ts`
  - Add `upsertNativeSession`, `importNativeMessages`, and sync-state update methods; preserve canonical session identity during resume/takeover.
- `hub/src/web/index.ts`
  - Register new CLI-only native ingest routes.
- `hub/src/web/routes/cli.ts`
  - Share CLI auth helpers if needed by the new ingest routes.
- `cli/src/api/api.ts`
  - Add authenticated hub calls for native session upsert, native message import, and sync-state updates.
- `cli/src/runner/run.ts`
  - Start/stop the machine-scoped native sync service together with the runner.
- `cli/src/claude/utils/sessionScanner.ts`
  - Extract Claude file parsing primitives so runtime scanner and native provider share one parser.
- `cli/src/codex/utils/codexSessionScanner.ts`
  - Extract Codex file parsing primitives so runtime scanner and native provider share one parser.
- `web/src/components/SessionList.tsx`
  - Add lightweight native/hybrid source badge.
- `web/src/components/SessionHeader.tsx`
  - Add lightweight source badge and native session ID display.
- `web/src/lib/locales/en.ts`
  - Add native/hybrid labels.
- `web/src/lib/locales/zh-CN.ts`
  - Add native/hybrid labels.

### New files to create
- `hub/src/store/nativeSyncState.ts`
  - SQL helpers for CRUD on `native_sync_state`.
- `hub/src/store/nativeSyncStateStore.ts`
  - Store wrapper for sync cursors and health state.
- `hub/src/store/nativeSyncStateStore.test.ts`
  - Focused tests for sync-state persistence and updates.
- `hub/src/store/messages.nativeImport.test.ts`
  - Focused tests for idempotent native message import.
- `hub/src/web/routes/cliNative.ts`
  - CLI-authenticated endpoints for native session upsert and message import.
- `hub/src/web/routes/cliNative.test.ts`
  - Route tests for auth, idempotency, and validation.
- `cli/src/nativeSync/types.ts`
  - Shared native provider and native message/session summary types.
- `cli/src/nativeSync/NativeSyncService.ts`
  - Machine-scoped orchestrator for discovery, import, incremental polling, and cursor persistence.
- `cli/src/nativeSync/NativeSyncService.test.ts`
  - Service tests for discovery, resume-from-cursor, and duplicate suppression.
- `cli/src/nativeSync/providers/provider.ts`
  - Provider interface and stable-tag/project-key helpers.
- `cli/src/nativeSync/providers/claude.ts`
  - Claude project/session discovery + history/tail adapter.
- `cli/src/nativeSync/providers/claude.test.ts`
  - Claude provider tests with real fixture JSONL.
- `cli/src/nativeSync/providers/codex.ts`
  - Codex session discovery + history/tail adapter.
- `cli/src/nativeSync/providers/codex.test.ts`
  - Codex provider tests with synthetic session trees.
- `cli/src/claude/utils/nativeLogReader.ts`
  - Shared Claude JSONL parser for both runtime scanner and native provider.
- `cli/src/codex/utils/nativeEventReader.ts`
  - Shared Codex event-file reader for both runtime scanner and native provider.
- `web/src/components/SessionSourceBadge.tsx`
  - Reusable source badge used in list and header.

### Design constraints to keep
- Keep SQLite as the only web/query store; do not read native files from hub/web.
- Native discovery/sync is only available when the machine runner is online.
- Canonical HAPI session tag format must be stable and deterministic: `native:<provider>:<projectKey>:<nativeSessionId>`.
- Native import must be idempotent at the message level; repeated scans must not duplicate rows.
- Resume/takeover must continue to use existing metadata fields (`claudeSessionId`, `codexSessionId`) so current web actions keep working.
- Do not redesign TanStack Query/SSE flows in this change.
- Do not attempt full-text search or offline caching of native files in this change.

## Chunk 1: Storage, schema, and hub ingest foundation

### Task 1: Extend shared metadata for native-source sessions

**Files:**
- Modify: `shared/src/schemas.ts`

- [ ] **Step 1: Write the failing shared schema test or extend an existing metadata parse test**

Add/extend a test proving metadata accepts native-source fields without breaking existing HAPI-only sessions.

```ts
expect(MetadataSchema.parse({
    path: '/repo',
    host: 'mbp',
    flavor: 'claude',
    source: 'native',
    nativeProvider: 'claude',
    nativeSessionId: 'abc',
    nativeProjectPath: '/Users/me/.claude/projects/-repo',
    nativeDiscoveredAt: 1,
    nativeLastSyncedAt: 2,
})).toMatchObject({
    source: 'native',
    nativeProvider: 'claude',
    nativeSessionId: 'abc'
})
```

- [ ] **Step 2: Extend `MetadataSchema` minimally**

Add optional fields only:

```ts
source: z.enum(['hapi', 'native', 'hybrid']).optional(),
nativeProvider: z.enum(['claude', 'codex']).optional(),
nativeSessionId: z.string().optional(),
nativeProjectPath: z.string().optional(),
nativeDiscoveredAt: z.number().optional(),
nativeLastSyncedAt: z.number().optional(),
```

- [ ] **Step 3: Run the focused shared test**

Run: `bun test shared`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add shared/src/schemas.ts
git commit -m "feat(shared): add native session metadata fields"
```

### Task 2: Make message storage idempotent for native imports

**Files:**
- Modify: `hub/src/store/index.ts`
- Modify: `hub/src/store/types.ts`
- Modify: `hub/src/store/messages.ts`
- Modify: `hub/src/store/messageStore.ts`
- Create: `hub/src/store/messages.nativeImport.test.ts`

- [ ] **Step 1: Write the failing native-import store test**

Test repeated import of the same native message key only creates one row and preserves order for distinct keys.

```ts
const first = store.messages.importNativeMessage('sid', { content: { role: 'assistant' }, createdAt: 1, sourceProvider: 'claude', sourceSessionId: 'native-1', sourceKey: 'line:1' })
const second = store.messages.importNativeMessage('sid', { content: { role: 'assistant' }, createdAt: 1, sourceProvider: 'claude', sourceSessionId: 'native-1', sourceKey: 'line:1' })
expect(first.id).toBe(second.id)
expect(store.messages.getMessages('sid').length).toBe(1)
```

- [ ] **Step 2: Extend schema and stored types**

Add nullable columns and index in `hub/src/store/index.ts`:

```sql
ALTER TABLE messages ADD COLUMN source_provider TEXT;
ALTER TABLE messages ADD COLUMN source_session_id TEXT;
ALTER TABLE messages ADD COLUMN source_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_native_source
ON messages(session_id, source_provider, source_session_id, source_key)
WHERE source_key IS NOT NULL;
```

Also extend `StoredMessage` with `sourceProvider`, `sourceSessionId`, `sourceKey`.

- [ ] **Step 3: Implement `importNativeMessage(...)` in message store**

Rules:
- If `source_key` exists and row already exists for the same `(session_id, provider, source_session_id, source_key)`, return the existing row.
- Otherwise insert with next seq.
- Keep existing `addMessage(...)` behavior untouched for HAPI-originated messages.

- [ ] **Step 4: Run focused hub store tests**

Run: `bun test hub/src/store/messages.nativeImport.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hub/src/store/index.ts hub/src/store/types.ts hub/src/store/messages.ts hub/src/store/messageStore.ts hub/src/store/messages.nativeImport.test.ts
git commit -m "feat(hub): add idempotent native message import"
```

### Task 3: Persist sync cursors and health in a dedicated store

**Files:**
- Modify: `hub/src/store/index.ts`
- Modify: `hub/src/store/types.ts`
- Create: `hub/src/store/nativeSyncState.ts`
- Create: `hub/src/store/nativeSyncStateStore.ts`
- Create: `hub/src/store/nativeSyncStateStore.test.ts`

- [ ] **Step 1: Write the failing sync-state persistence test**

Cover upsert + reload across store instances.

```ts
store.nativeSyncState.upsert({
    sessionId: 'sid',
    provider: 'claude',
    nativeSessionId: 'native-1',
    machineId: 'machine-1',
    cursor: '42',
    filePath: '/tmp/session.jsonl',
    lastSyncedAt: 123,
    syncStatus: 'healthy'
})
expect(store.nativeSyncState.getBySessionId('sid')?.cursor).toBe('42')
```

- [ ] **Step 2: Add the `native_sync_state` table and store types**

Suggested columns:

```sql
session_id TEXT PRIMARY KEY,
provider TEXT NOT NULL,
native_session_id TEXT NOT NULL,
machine_id TEXT NOT NULL,
cursor TEXT,
file_path TEXT,
mtime INTEGER,
last_synced_at INTEGER,
sync_status TEXT NOT NULL,
last_error TEXT
```

- [ ] **Step 3: Implement store wrapper methods**

Minimum methods:
- `getBySessionId(sessionId)`
- `upsert(state)`
- `markError(sessionId, message, timestamp)`
- `listByMachine(machineId)`

- [ ] **Step 4: Run focused sync-state tests**

Run: `bun test hub/src/store/nativeSyncStateStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hub/src/store/index.ts hub/src/store/types.ts hub/src/store/nativeSyncState.ts hub/src/store/nativeSyncStateStore.ts hub/src/store/nativeSyncStateStore.test.ts
git commit -m "feat(hub): persist native sync state"
```

### Task 4: Add CLI-authenticated native ingest endpoints and sync-engine methods

**Files:**
- Modify: `hub/src/sync/syncEngine.ts`
- Modify: `hub/src/web/index.ts`
- Create: `hub/src/web/routes/cliNative.ts`
- Create: `hub/src/web/routes/cliNative.test.ts`

- [ ] **Step 1: Write the failing route tests**

Cover:
- CLI auth required
- session upsert is idempotent by stable tag
- repeated message import is idempotent
- sync-state updates validate provider/session identity

- [ ] **Step 2: Add minimal sync-engine import methods**

Add methods shaped like:

```ts
upsertNativeSession(payload: {
  tag: string
  namespace: string
  metadata: unknown
  agentState?: unknown | null
}): Session

importNativeMessages(sessionId: string, payload: Array<{
  content: unknown
  createdAt: number
  sourceProvider: 'claude' | 'codex'
  sourceSessionId: string
  sourceKey: string
}>): { imported: number; session: Session }

updateNativeSyncState(payload: { ... }): void
```

On new imports, emit normal session/message events so SSE/web stay unchanged.

- [ ] **Step 3: Create CLI-only native ingest routes**

Suggested routes:
- `POST /cli/native/sessions/upsert`
- `POST /cli/native/sessions/:id/messages/import`
- `POST /cli/native/sessions/:id/sync-state`

Reuse existing bearer auth + namespace extraction pattern from `hub/src/web/routes/cli.ts`.

- [ ] **Step 4: Run focused route tests**

Run: `bun test hub/src/web/routes/cliNative.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hub/src/sync/syncEngine.ts hub/src/web/index.ts hub/src/web/routes/cliNative.ts hub/src/web/routes/cliNative.test.ts
git commit -m "feat(hub): add native session ingest endpoints"
```

## Chunk 2: Machine-scoped native sync service and Claude provider

### Task 5: Extract a reusable Claude native log reader

**Files:**
- Create: `cli/src/claude/utils/nativeLogReader.ts`
- Modify: `cli/src/claude/utils/sessionScanner.ts`

- [ ] **Step 1: Write the failing Claude reader test using existing fixture JSONL**

Use `cli/src/claude/utils/__fixtures__/...jsonl` to assert the shared reader:
- skips internal events
- returns stable source keys (for example `line:<index>`)
- extracts message timestamps and session IDs

- [ ] **Step 2: Move file-parsing logic out of `sessionScanner.ts`**

Extract the current `readSessionLog(...)` behavior into `nativeLogReader.ts` with a result type like:

```ts
type ClaudeNativeRecord = {
  sessionId: string
  sourceKey: string
  createdAt: number
  content: unknown
}
```

Keep runtime scanner behavior unchanged by having `sessionScanner.ts` call the new helper.

- [ ] **Step 3: Run focused Claude scanner tests**

Run: `bun test cli/src/claude/utils/sessionScanner.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add cli/src/claude/utils/nativeLogReader.ts cli/src/claude/utils/sessionScanner.ts
git commit -m "refactor(cli): extract Claude native log reader"
```

### Task 6: Build the generic native sync service and stable-tag mapping

**Files:**
- Create: `cli/src/nativeSync/types.ts`
- Create: `cli/src/nativeSync/providers/provider.ts`
- Create: `cli/src/nativeSync/NativeSyncService.ts`
- Create: `cli/src/nativeSync/NativeSyncService.test.ts`
- Modify: `cli/src/api/api.ts`

- [ ] **Step 1: Write the failing service tests with a fake provider**

Cover:
- new native session becomes one canonical HAPI session
- repeated scan uses same tag/session
- only unseen native messages are imported
- persisted cursor resumes after restart

- [ ] **Step 2: Define provider and payload interfaces**

Minimum shapes:

```ts
export type NativeProviderName = 'claude' | 'codex'
export type NativeSessionSummary = {
  provider: NativeProviderName
  nativeSessionId: string
  projectPath: string
  displayPath: string
  flavor: 'claude' | 'codex'
  discoveredAt: number
  lastActivityAt: number
  title?: string
}
export type NativeMessage = {
  sourceKey: string
  createdAt: number
  content: unknown
}
```

Add a `buildStableNativeTag(summary)` helper that hashes the normalized project path + native session ID.

- [ ] **Step 3: Implement the service orchestration**

The service should:
- periodically call each provider’s `discoverSessions()`
- call hub `upsertNativeSession(...)`
- fetch `sync-state`
- import initial history or tail increments
- update sync state after each successful pass
- mark sync errors without crashing the loop

- [ ] **Step 4: Add CLI API methods**

Extend `cli/src/api/api.ts` with:
- `upsertNativeSession(...)`
- `importNativeMessages(...)`
- `updateNativeSyncState(...)`

Reuse existing token auth and response validation style.

- [ ] **Step 5: Run focused native sync tests**

Run: `bun test cli/src/nativeSync/NativeSyncService.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add cli/src/nativeSync/types.ts cli/src/nativeSync/providers/provider.ts cli/src/nativeSync/NativeSyncService.ts cli/src/nativeSync/NativeSyncService.test.ts cli/src/api/api.ts
git commit -m "feat(cli): add native sync service foundation"
```

### Task 7: Implement Claude provider and wire it into the runner lifecycle

**Files:**
- Create: `cli/src/nativeSync/providers/claude.ts`
- Create: `cli/src/nativeSync/providers/claude.test.ts`
- Modify: `cli/src/runner/run.ts`

- [ ] **Step 1: Write the failing Claude provider tests**

Cover:
- enumerate `~/.claude/projects/<project-id>/*.jsonl`
- derive one `NativeSessionSummary` per file
- import full history in order
- tail only newly appended lines after cursor

- [ ] **Step 2: Implement Claude discovery on top of the shared reader**

Use existing `getProjectPath(...)` mapping semantics and enumerate real project directories. Cursor can be `JSON.stringify({ filePath, line: number })` for the first version.

- [ ] **Step 3: Start/stop the service from the runner**

In `cli/src/runner/run.ts`:
- construct `NativeSyncService` after machine registration succeeds
- pass machine ID + namespace + API client
- start service with the Claude provider at runner startup
- stop service during runner shutdown

This is required so native CLI sessions are discovered even when no HAPI-managed session is active.

- [ ] **Step 4: Run focused Claude provider tests**

Run: `bun test cli/src/nativeSync/providers/claude.test.ts`
Expected: PASS

- [ ] **Step 5: Run runner-related focused tests**

Run: `bun test cli/src/runner`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add cli/src/nativeSync/providers/claude.ts cli/src/nativeSync/providers/claude.test.ts cli/src/runner/run.ts
git commit -m "feat(cli): sync native Claude sessions through runner"
```

## Chunk 3: Codex provider, hybrid takeover, and visible UX

### Task 8: Extract a reusable Codex native event reader and provider

**Files:**
- Create: `cli/src/codex/utils/nativeEventReader.ts`
- Modify: `cli/src/codex/utils/codexSessionScanner.ts`
- Create: `cli/src/nativeSync/providers/codex.ts`
- Create: `cli/src/nativeSync/providers/codex.test.ts`

- [ ] **Step 1: Write the failing Codex reader/provider tests**

Cover:
- enumerating session files under `CODEX_HOME/sessions`
- deriving project ownership from recorded cwd
- buffering/ordering events consistently
- tailing appended events without duplicates

- [ ] **Step 2: Extract low-level Codex file parsing**

Move raw file reading and line-to-event parsing from `codexSessionScanner.ts` into `nativeEventReader.ts`; keep existing runtime scanner behavior unchanged by reusing the helper.

- [ ] **Step 3: Implement Codex provider**

Rules:
- scan all session files
- reject files without a resolvable cwd
- normalize cwd before building project key
- use deterministic source keys such as `file:<relative-path>:line:<index>`

- [ ] **Step 4: Run focused Codex tests**

Run: `bun test cli/src/nativeSync/providers/codex.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cli/src/codex/utils/nativeEventReader.ts cli/src/codex/utils/codexSessionScanner.ts cli/src/nativeSync/providers/codex.ts cli/src/nativeSync/providers/codex.test.ts
git commit -m "feat(cli): add native Codex session provider"
```

### Task 9: Preserve one canonical session across import and takeover

**Files:**
- Modify: `hub/src/sync/syncEngine.ts`
- Modify: `hub/src/store/sessions.ts` (only if tiny helper is required)
- Add tests near existing hub sync tests (for example `hub/src/sync/nativeImportResume.test.ts`)

- [ ] **Step 1: Write the failing takeover test**

Scenario:
1. native session is imported as `source: native`
2. user resumes it from web
3. resumed HAPI session reuses or merges into the same canonical thread
4. metadata transitions to `source: hybrid`
5. session list still shows one session, not two

- [ ] **Step 2: Implement canonical merge rules**

Preferred order:
- if resume returns same session ID, simply patch metadata to `hybrid`
- if resume returns a new HAPI session ID, immediately merge into the existing canonical imported session and keep the imported ID visible to the web

Keep existing `claudeSessionId` / `codexSessionId` fields authoritative for resume tokens.

- [ ] **Step 3: Run focused sync tests**

Run: `bun test hub/src/sync`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add hub/src/sync/syncEngine.ts hub/src/sync/nativeImportResume.test.ts
git commit -m "feat(hub): keep native and resumed sessions unified"
```

### Task 10: Add minimal UI affordances for native and hybrid sessions

**Files:**
- Create: `web/src/components/SessionSourceBadge.tsx`
- Modify: `web/src/components/SessionList.tsx`
- Modify: `web/src/components/SessionHeader.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

- [ ] **Step 1: Write the failing component tests or snapshots**

Cover:
- `source: native` renders “Native” badge
- `source: hybrid` renders “Hybrid” badge
- header shows native provider + native session ID when present

- [ ] **Step 2: Implement the reusable badge component**

Keep it tiny:

```tsx
<SessionSourceBadge source={session.metadata?.source} provider={session.metadata?.nativeProvider} />
```

- [ ] **Step 3: Thread the badge into list and header only**

Do not redesign the session card layout; add one compact badge row and optional native session ID text in the header action area.

- [ ] **Step 4: Run focused web tests/typecheck**

Run: `bun run typecheck:web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SessionSourceBadge.tsx web/src/components/SessionList.tsx web/src/components/SessionHeader.tsx web/src/lib/locales/en.ts web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): show native and hybrid session badges"
```

### Task 11: End-to-end verification and docs update

**Files:**
- Modify: `README.md` (only if one short note is needed)
- Modify: `cli/README.md` or `hub/README.md` (document runner requirement for native discovery)
- Optionally add: `docs/guide/...` if product docs need a short usage note

- [ ] **Step 1: Add one integration test for the native sync happy path**

Minimum scenario:
- start hub + runner test harness
- seed a native Claude session fixture and a native Codex session fixture
- wait for sync service to import both
- assert `/api/sessions` shows imported sessions
- append a new native message to one fixture
- assert the message appears through `/api/sessions/:id/messages`

- [ ] **Step 2: Run the full verification suite**

Run:
```bash
bun typecheck
bun run test
```
Expected: PASS

- [ ] **Step 3: Update docs briefly**

Document:
- native discovery requires an online runner on the machine
- native sessions appear as `Native`
- once resumed/taken over they appear as `Hybrid`

- [ ] **Step 4: Commit**

```bash
git add README.md cli/README.md hub/README.md docs/guide
git commit -m "docs: document native session sync"
```

## Execution notes
- Implement Chunk 1 completely before starting runner/provider work; everything later depends on idempotent import and sync-state persistence.
- Within Chunk 2 and Chunk 3, Claude and Codex provider tasks are good candidates for parallel subagents because their write scopes can stay mostly disjoint.
- Do not collapse `native_sync_state` into session metadata during implementation; keeping operational cursor state separate is what keeps retries and diagnostics sane.
- If Codex provider discovery proves materially harder than estimated, keep the generic service/provider abstractions and ship Claude first behind the same architecture, then land Codex in a follow-up using the already-tested ingest path.

Plan complete and saved to `docs/superpowers/plans/2026-03-15-native-session-sync.md`. Ready to execute?
