# Session Native Time Semantics Design

## Background

Current session time semantics are wrong for native-synced sessions:

- `session.createdAt` currently behaves like "first synced into HAPI" in some flows.
- `session.updatedAt` is currently affected by metadata updates, agent-state updates, and other non-message touches.
- Native providers sometimes inflate activity timestamps with file `mtime`, which makes session recency diverge from the real conversation timeline.

The user requirement is explicit:

- `session.createdAt` must come from the real native session creation time.
- `session.updatedAt` must be the time of the last message.
- Data correctness is more important than compatibility.
- No migration/backfill complexity is needed; rebuilding the DB is acceptable.

## Goal

Make session time fields authoritative and simple:

- `session.createdAt` = real native session creation time
- `session.updatedAt` = last message time
- If a session has no messages yet, `updatedAt` falls back to native last activity time
- If later sync discovers an earlier true creation time, `createdAt` can move earlier

## Non-Goals

- No backward-compatibility preservation for old timestamp behavior
- No DB migration for existing rows
- No one-off repair job for existing sessions
- No derived-on-read timestamp computation from API/query layer only

## Agreed Semantics

### `session.createdAt`

For native or hybrid sessions, `createdAt` must be the real native session start time.

Priority is resolved inside the provider before data reaches the hub:

1. Explicit native session creation time from provider metadata
2. First native message time
3. Native file `birthtime`
4. Native file `mtime` as final fallback

The provider owns this arbitration and emits a single authoritative `createdAt`.

Store-side rule:

- provider `createdAt` is required for native upsert and is trusted as the authoritative native creation time
- if a later sync provides an earlier provider `createdAt`, session `createdAt` is allowed to move earlier by overwriting the stored value

This keeps responsibility clear:

- provider decides how to derive native creation time
- store does not second-guess provider `createdAt` with message timestamps

### `session.updatedAt`

`updatedAt` must represent the last message time.

Rules:

- If the session has messages: `updatedAt = max(message.createdAt)`
- If the session has no messages yet:
  - native/hybrid session: `updatedAt = native lastActivityAt`
  - otherwise: `updatedAt = createdAt`

### Timestamp invariants

To keep data valid and simple:

- only finite positive millisecond timestamps are accepted
- provider must emit `createdAt` and `lastActivityAt` such that `lastActivityAt >= createdAt`
- hub reconciliation must guarantee `updatedAt >= createdAt`
- no extra “future timestamp” heuristics are introduced; if native logs provide a finite positive timestamp, treat it as authoritative
- out-of-order message arrival is allowed; reconciliation always uses min/max message timestamps rather than insertion order

### Non-message updates

The following must not affect `session.updatedAt`:

- metadata updates
- agent-state updates
- native sync-state updates
- alias synchronization
- other bookkeeping-only writes

## Architecture

Implement timestamp correctness at the provider + sync/store layer, not in API presentation.

This keeps a single source of truth:

- providers extract authoritative native times
- sync API sends those times explicitly
- hub store reconciles session timestamps using native summary data plus imported message timestamps
- API, sorting, and UI then consume already-correct session records

## Design Details

### 1. Native session summaries expose explicit time semantics

`cli/src/nativeSync/types.ts`

Change native session summaries to carry explicit authoritative fields:

- `createdAt`
- `lastActivityAt`

`discoveredAt` should no longer be used as the semantic session creation time. If retained for metadata/debugging, it is secondary and must never drive `session.createdAt`.

### 2. Claude provider timestamp extraction

`cli/src/nativeSync/providers/claude.ts`

For each Claude native session:

- `createdAt`
  1. first parseable native event timestamp
  2. fallback: file `birthtime`
  3. fallback: file `mtime`
- `lastActivityAt`
  1. last parseable native event timestamp
  2. fallback: file `mtime`

Important:

- do not inflate `lastActivityAt` with `Math.max(eventTime, mtime)`
- if event timestamps exist, trust them
- `mtime` is fallback only
- if extracted `lastActivityAt < createdAt`, coerce `lastActivityAt = createdAt`

### 3. Codex provider timestamp extraction

`cli/src/nativeSync/providers/codex.ts`

For each Codex native session:

- `createdAt`
  1. `session_meta.payload.timestamp`
  2. fallback: first parseable event timestamp
  3. fallback: file `birthtime`
  4. fallback: file `mtime`
- `lastActivityAt`
  1. last non-`session_meta` event timestamp
  2. fallback: `session_meta.payload.timestamp`
  3. fallback: file `mtime`

Important:

- do not inflate `lastActivityAt` with `Math.max(..., mtime)` when an actual event timestamp exists
- prefer real event chronology over filesystem mutation time
- if extracted `lastActivityAt < createdAt`, coerce `lastActivityAt = createdAt`

### 4. CLI -> Hub native upsert sends explicit timestamps

`cli/src/api/api.ts`
`cli/src/nativeSync/NativeSyncService.ts`
`hub/src/web/routes/cliNative.ts`
`hub/src/sync/syncEngine.ts`

Native session upsert payload must include explicit top-level fields:

- `createdAt`
- `lastActivityAt`

Contract:

- both fields are required in the CLI API type
- both fields are required in the HTTP route schema
- both fields are validated in `hub/src/web/routes/cliNative.ts`
- route validation rejects non-finite or non-positive numbers
- engine/store may assume validated values after the route boundary

Reason:

- hub should not guess these from sync time
- hub should not infer semantic timestamps from unrelated metadata fields
- provider semantics stay explicit across the boundary

Metadata may still carry native diagnostic fields, but session timestamp authority should come from explicit payload fields.

### 5. Hub store owns final timestamp reconciliation

Introduce a dedicated session timestamp reconciliation path in the session store layer.

Inputs:

- `sessionId`
- `namespace`
- candidate native `createdAt`
- fallback native `lastActivityAt`

Precondition:

- this design targets fresh data after DB rebuild
- no attempt is made to repair or reinterpret legacy rows created under the old semantics
- native timestamp reconciliation assumes `candidate createdAt` is always present for native upsert
- for sessions participating in native reconciliation, provider `createdAt` is the only authority for `session.createdAt`

The reconciliation logic reads the session's messages and computes:

- `maxMessageCreatedAt`

Then persists:

- final `createdAt = candidateCreatedAt`
- final `updatedAt = maxMessageCreatedAt ?? fallbackLastActivityAt ?? finalCreatedAt`
- after calculation, enforce `updatedAt = max(updatedAt, createdAt)`

Properties:

- `createdAt` may move earlier when a later provider sync emits an earlier authoritative value
- `updatedAt` is allowed to move to the true last-message time, even if that differs from a previous bookkeeping-derived value
- reconciliation is deterministic and idempotent

### 6. Reconciliation call sites

#### Native upsert path

After `upsertNativeSession(...)` resolves the canonical session, reconcile timestamps immediately using:

- provider `createdAt`
- provider `lastActivityAt`

This ensures a newly discovered native session gets correct timestamps even before message import completes.

#### Native message import path

After a native message batch import finishes, reconcile timestamps again.

This ensures:

- `updatedAt` becomes exactly the last message time
- `createdAt` remains the provider-authoritative native creation time and is not recomputed from message timestamps

### 7. Hybrid session rule

For hybrid sessions, the same reconciliation rule applies:

- if messages exist in the session, `updatedAt` must come from the last message timestamp in that session
- native `lastActivityAt` is only a no-message fallback

This prevents native summary refreshes or file metadata changes from overriding true chat chronology.

### 8. Remove timestamp pollution from unrelated writes

The following existing behaviors must be corrected so they no longer redefine session recency:

- metadata update paths that touch `updated_at`
- agent-state update paths that touch `updated_at`
- sync-state writes that accidentally imply freshness of conversation

Allowed write points:

- live HAPI message creation path may set `updatedAt` from that new message timestamp
- native message import path may set `updatedAt` from imported message timestamps
- explicit session timestamp reconciliation path may set both `createdAt` and `updatedAt`

Everything else must not write session recency fields.

## Data Flow

1. Native provider scans local native session files
2. Provider emits summary with authoritative `createdAt` and `lastActivityAt`
3. CLI upserts native session with explicit timestamps
4. Hub creates/resolves canonical session
5. Hub reconciles session timestamps using native summary + current messages
6. CLI imports native messages
7. Hub reconciles session timestamps again using imported messages
8. Web/session list reads already-correct `createdAt` and `updatedAt`

## Why this approach

### Rejected: API-layer derived timestamps only

Rejected because storage semantics remain wrong and every consumer must remember to re-derive timestamps.

### Rejected: query-time aggregation only

Rejected because it adds complexity, repeated work, and fallback edge cases for sessions without messages.

### Chosen: provider + sync/store correction

Chosen because it is the simplest architecture with one authoritative meaning for each field.

## Error Handling

- If provider cannot extract a true session creation timestamp, use the documented fallback chain.
- If no message timestamps exist yet, use `lastActivityAt`, then `createdAt`.
- If a later sync yields better timestamps, reconciliation overwrites previous less-accurate values.
- If provider extraction would produce `lastActivityAt < createdAt`, coerce `lastActivityAt = createdAt` before sending.
- If reconciliation computes `updatedAt < createdAt`, set `updatedAt = createdAt`.
- Reject non-finite or non-positive route payload timestamps at the HTTP schema boundary.
- No compatibility fallback should preserve old incorrect semantics.

## Testing Strategy

### Provider tests

Add/update provider tests to verify:

- Claude `createdAt` uses first event time, not sync/import time
- Claude `lastActivityAt` uses last event time, not inflated `mtime`
- Codex `createdAt` prefers `session_meta.payload.timestamp`
- Codex `lastActivityAt` prefers last non-`session_meta` event time
- fallback chains work when timestamps are missing

### Store tests

Add tests for session timestamp reconciliation:

- no-message session uses native `createdAt` + native `lastActivityAt`
- with messages, `updatedAt` becomes last message time
- with later sync providing an earlier provider `createdAt`, session `createdAt` moves earlier
- repeated reconciliation is idempotent

### Sync/integration tests

Add/update integration tests to verify:

- native session `createdAt` equals real native creation time after first sync
- native session `updatedAt` equals last imported message time after import
- native session with zero imported messages uses provider `lastActivityAt`
- hybrid session `updatedAt` remains tied to last message, not metadata churn

## Implementation Boundaries

Expected code areas:

- `cli/src/nativeSync/types.ts`
- `cli/src/nativeSync/providers/claude.ts`
- `cli/src/nativeSync/providers/codex.ts`
- `cli/src/nativeSync/NativeSyncService.ts`
- `cli/src/api/api.ts`
- `hub/src/web/routes/cliNative.ts`
- `hub/src/sync/syncEngine.ts`
- `hub/src/store/sessions.ts`
- related tests in CLI/hub native sync and store layers

## Simplicity Constraints

The user explicitly prefers simplicity over compatibility work.

Therefore:

- no migration
- no background repair pass
- no compatibility branches for old semantics
- no "temporary" dual meaning for timestamps

If the DB is rebuilt, first sync must populate correct timestamps directly.
