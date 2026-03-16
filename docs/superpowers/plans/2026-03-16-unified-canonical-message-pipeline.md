# Unified Canonical Message Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HAPI's split message parsing chain with one hub-owned raw→canonical pipeline that ingests all providers, stores canonical root trees, serves `/sessions/:id/messages` directly as canonical timeline data, and renders reasoning/subagents/fallbacks without web-side semantic guessing.

**Architecture:** Add shared canonical contracts first, then introduce hub-side raw-event and canonical-block stores, a deterministic generation-based parser/rebuild engine, and one ingestion path for runtime + native inputs. Cut the web app over to generation-pinned canonical pagination and realtime root upserts, keeping only thin presentation adapters so Claude/Codex get high-fidelity parsing while Gemini/Cursor/OpenCode still remain visible through canonical fallback blocks.

**Tech Stack:** Bun workspaces, TypeScript strict, Zod, Bun SQLite, Hono, Socket.IO, SSE, React, TanStack Query, assistant-ui, Vitest.

**Execution note:** Per user preference, do not mechanically run every listed test after every micro-step. Implement the chunk first, then batch the listed verification near the end of that chunk unless a blocker/debugging loop forces an earlier smoke check.

---

## File Structure

### Existing files to modify

#### Shared protocol
- `shared/src/index.ts`
  - Export canonical contracts.
- `shared/src/schemas.ts`
  - Extend `SyncEventSchema`; keep session schemas while importing canonical schemas.
- `shared/src/socket.ts`
  - Add runtime raw-envelope payload contract first, then cut producers/consumers over in Chunk 4 without breaking intermediate commits.
- `shared/src/types.ts`
  - Re-export canonical protocol types.

#### Hub store / sync / routes
- `hub/src/store/index.ts`
  - Bump schema version, add canonical tables/stores, and fail fast on pre-canonical DBs instead of carrying migration debt.
- `hub/src/store/types.ts`
  - Add stored raw-event / canonical-block / parse-state / staged-child types.
- `hub/src/sync/messageService.ts`
  - Stop reading/writing legacy message rows for history; ingest raw events, expose canonical pagination, trigger rebuild/reset semantics.
- `hub/src/sync/syncEngine.ts`
  - Wire canonical message service into session/native flows; surface generation-pinned history reads.
- `hub/src/socket/handlers/cli/sessionHandlers.ts`
  - Accept runtime raw envelopes from CLI instead of UI-shaped messages.
- `hub/src/web/routes/messages.ts`
  - Redefine `/sessions/:id/messages` to canonical page contract with `generation` + `beforeTimelineSeq`.
- `hub/src/web/routes/cli.ts`
  - Keep CLI backfill alive using raw runtime ingress cursor instead of legacy message seqs.
- `hub/src/web/routes/cliNative.ts`
  - Accept native raw event batches rather than pre-normalized history messages.
- `hub/src/sse/sseManager.ts`
  - Route `canonical-root-upsert` / `canonical-reset` correctly to session subscribers.
- `hub/src/sync/eventPublisher.ts`
  - Publish canonical sync events with namespace enrichment.
- `hub/src/notifications/notificationHub.ts`
  - Stop depending on `message-received` event parsing for ready notifications.
- `hub/src/notifications/eventParsing.ts`
  - Rework helper logic around canonical/session state transitions.

#### CLI / native sync
- `cli/src/api/api.ts`
  - Send native raw event batches to hub.
- `cli/src/api/apiSession.ts`
  - Emit runtime raw envelopes to hub, and backfill outbound user messages from raw-ingest cursor instead of message seq.
- `cli/src/nativeSync/types.ts`
  - Replace native message import payloads with native raw event batches.
- `cli/src/nativeSync/NativeSyncService.ts`
  - Chunk and upload native raw events; keep timestamp/session upsert semantics.
- `cli/src/nativeSync/providers/provider.ts`
  - Define native provider batch as raw envelopes, not display messages.
- `cli/src/nativeSync/providers/claude.ts`
  - Emit Claude native raw envelopes with stable source keys / observation keys / source order.
- `cli/src/nativeSync/providers/codex.ts`
  - Emit Codex native raw envelopes with stable source keys / source order.
- `cli/src/claude/utils/nativeLogReader.ts`
  - Expose enough source facts for high-fidelity Claude raw envelopes.
- `cli/src/codex/utils/nativeEventReader.ts`
  - Expose enough source facts for high-fidelity Codex raw envelopes.

#### Web
- `web/src/types/api.ts`
  - Replace `DecryptedMessage[]` history types with canonical root/page/realtime types.
- `web/src/api/client.ts`
  - Request canonical pages using `generation` + `beforeTimelineSeq`.
- `web/src/hooks/queries/useMessages.ts`
  - Return canonical roots/window state instead of decrypted messages.
- `web/src/lib/message-window-store.ts`
  - Store canonical roots + generation + stream cursor + optimistic pending user roots.
- `web/src/lib/canonical-realtime.ts`
  - Keep canonical realtime merge/reset logic out of `useSSE.ts` and `message-window-store.ts`.
- `web/src/hooks/useSSE.ts`
  - Apply `canonical-root-upsert` / `canonical-reset` to the message window store.
- `web/src/router.tsx`
  - Thread canonical message state into `SessionChat`.
- `web/src/components/SessionChat.tsx`
  - Remove normalize/reducer pipeline usage; render canonical-derived blocks.
- `web/src/lib/assistant-runtime.ts`
  - Convert canonical render blocks into assistant-ui thread messages.
- `web/src/chat/types.ts`
  - Replace reducer-era block unions with canonical render block unions.
- `web/src/components/AssistantChat/messages/ToolMessage.tsx`
  - Render canonical tool/subagent/fallback artifacts.
- `web/src/components/assistant-ui/reasoning.tsx`
  - Default reasoning closed; no streaming auto-open.
- `web/src/components/ToolCard/ToolCard.tsx`
  - Remove assumptions that `Task` is the only nested timeline container.
- `web/src/components/SessionChat.test.tsx`
  - Update tests to assert canonical rendering behavior.

### New files to create

#### Shared protocol
- `shared/src/canonical.ts`
  - Zod schemas + TypeScript types for raw events, canonical blocks, messages page contract, and canonical realtime sync events.
- `shared/src/canonical.test.ts`
  - Focused protocol tests for schema acceptance/rejection and block-tree validation.

#### Hub persistence
- `hub/src/store/rawEvents.ts`
  - SQL helpers for immutable raw-event ingest/query.
- `hub/src/store/rawEventStore.ts`
  - Store wrapper for raw-event ingest, query, and CLI backfill reads.
- `hub/src/store/rawEventStore.test.ts`
  - Tests for idempotency, ingest cursor, and session ordering queries.
- `hub/src/store/canonicalBlocks.ts`
  - SQL helpers for canonical root/child storage and generation-pinned pagination.
- `hub/src/store/canonicalBlockStore.ts`
  - Store wrapper for canonical writes/reads.
- `hub/src/store/canonicalBlockStore.test.ts`
  - Tests for root pagination, child ordering, and replace-vs-append updates.
- `hub/src/store/sessionParseState.ts`
  - SQL helpers for parser state, last processed raw sort identity, latest stream seq, and rebuild bookkeeping.
- `hub/src/store/sessionParseStateStore.ts`
  - Store wrapper for active generation / parser state persistence.
- `hub/src/store/sessionParseStateStore.test.ts`
  - Tests for active generation cutover and rebuild-required flags.
- `hub/src/store/stagedChildRawEvents.ts`
  - SQL helpers for unresolved child-session staging rows.
- `hub/src/store/stagedChildRawEventStore.ts`
  - Store wrapper for stage/rehome/delete child raw events.
- `hub/src/store/stagedChildRawEventStore.test.ts`
  - Tests for staging + atomic rehome flow.

#### Hub parser / API tests
- `hub/src/canonical/parser.ts`
  - Deterministic session parser from ordered raw events to canonical roots + parser state.
- `hub/src/canonical/parser.test.ts`
  - Fixture-driven parser tests for Claude/Codex/fallback behavior.
- `hub/src/canonical/rebuild.ts`
  - Session rebuild executor with snapshot boundary and generation cutover.
- `hub/src/canonical/rebuild.test.ts`
  - Tests for deterministic rebuild and late-arrival handling.
- `hub/src/canonical/providerParsers/claude.ts`
  - Claude-specific canonical upgrade helpers.
- `hub/src/canonical/providerParsers/codex.ts`
  - Codex-specific canonical upgrade helpers.
- `hub/src/canonical/providerParsers/fallback.ts`
  - Shared fallback/unknown-event upgrade helpers for all providers.
- `hub/src/sync/canonicalPipeline.integration.test.ts`
  - Integration tests for ingest→parse→page→realtime flow.
- `hub/src/socket/handlers/cli/sessionHandlers.test.ts`
  - Tests for runtime raw-envelope ingest and CLI delivery behavior.
- `hub/src/web/routes/messages.test.ts`
  - Route tests for canonical pagination and `409 reset-required`.
- `hub/src/web/routes/cli.test.ts`
  - CLI route tests for raw-ingest backfill cursor reads.
- `web/src/hooks/useSSE.test.ts`
  - Tests for stream-seq gating, generation mismatch reset, and refetch triggers.

#### Web
- `web/src/chat/canonical.ts`
  - Thin adapter from canonical roots to render blocks used by assistant-ui + custom cards.
- `web/src/chat/canonical.test.ts`
  - Tests for reasoning/tool/subagent/fallback mapping.
- `web/src/components/chat/SubagentCard.tsx`
  - Explicit subagent tree card with lifecycle summary and nested timeline.
- `web/src/components/chat/FallbackRawCard.tsx`
  - Visible fallback-raw card with provider/raw-type labels and JSON preview.
- `web/src/components/assistant-ui/reasoning.test.tsx`
  - Tests for closed-by-default reasoning behavior.
- `web/src/lib/message-window-store.test.ts`
  - Tests for canonical append/replace/reset pagination behavior.
- `web/src/lib/canonical-realtime.ts`
  - Small reducer for `streamSeq` gating, generation mismatch handling, and root append/replace decisions.

### Files to delete once the cutover is complete
- `hub/src/store/messages.ts`
- `hub/src/store/messageStore.ts`
- `web/src/chat/normalize.ts`
- `web/src/chat/normalizeAgent.ts`
- `web/src/chat/normalizeUser.ts`
- `web/src/chat/reducer.ts`
- `web/src/chat/reducerCliOutput.ts`
- `web/src/chat/reducerEvents.ts`
- `web/src/chat/reducerTimeline.ts`
- `web/src/chat/reducerTools.ts`
- `web/src/chat/reconcile.ts`
- `web/src/chat/tracer.ts`
- `web/src/components/ToolCard/views/CodexReasoningView.tsx`

## Constraints

- No DB compatibility work: bump schema, fail fast on old DB, user deletes DB and rebuilds.
- No public API compatibility work: `/sessions/:id/messages` changes shape in-place.
- All source inputs must land in raw-event storage before canonical parsing.
- Claude + Codex must reach high-fidelity canonical mapping in v1.
- Gemini + Cursor + OpenCode must still enter the same pipeline; unsupported semantics become `fallback-raw`, never silent drop.
- Reasoning defaults closed globally; no persisted open-state memory; no streaming auto-open.
- Subagents render only from explicit canonical tree edges, not UI inference.
- Keep remote-control delivery to CLI working during the refactor; web-send → CLI receive/backfill cannot regress.

## Chunk 1: Shared canonical contracts

### Task 1: Lock the canonical wire contracts with failing shared tests

**Files:**
- Create: `shared/src/canonical.ts`
- Create: `shared/src/canonical.test.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Write failing protocol tests for raw envelopes, canonical roots, and page payloads**

Add tests that prove the new schemas accept the exact v1 contract and reject missing ordering fields.

```ts
const page = CanonicalMessagesPageSchema.parse({
    items: [{
        id: 'root-1',
        sessionId: 'session-1',
        timelineSeq: 1,
        siblingSeq: 0,
        parentBlockId: null,
        rootBlockId: 'root-1',
        depth: 0,
        kind: 'reasoning',
        createdAt: 1,
        updatedAt: 2,
        state: 'streaming',
        payload: { text: 'thinking...' },
        sourceRawEventIds: ['raw-1'],
        parserVersion: 1,
        generation: 3,
        children: []
    }],
    page: {
        generation: 3,
        parserVersion: 1,
        latestStreamSeq: 9,
        limit: 50,
        beforeTimelineSeq: null,
        nextBeforeTimelineSeq: null,
        hasMore: false
    }
})
expect(page.items[0].kind).toBe('reasoning')

expect(() => RawEventEnvelopeSchema.parse({
    id: 'raw-1',
    sessionId: 'session-1',
    provider: 'claude',
    source: 'runtime'
})).toThrow(/sourceOrder/i)
```

- [ ] **Step 2: Run the focused shared tests and verify they fail for missing canonical contracts**

Run:

```bash
bun test shared/src/canonical.test.ts
```

Expected: FAIL because `shared/src/canonical.ts` does not exist yet.

- [ ] **Step 3: Implement the canonical protocol module minimally but completely**

Create `shared/src/canonical.ts` with:
- provider/source enums
- raw event envelope schema
- canonical block schema, root block schema, closed event subtype enum
- page response schema
- canonical realtime event schemas
- exported inferred types

Minimum structure:

```ts
export const CanonicalBlockKindSchema = z.enum([
    'user-text',
    'agent-text',
    'reasoning',
    'tool-call',
    'tool-result',
    'event',
    'subagent-root',
    'fallback-raw'
])

export const RawEventEnvelopeSchema = z.object({
    id: z.string(),
    sessionId: z.string(),
    provider: z.enum(['claude', 'codex', 'gemini', 'cursor', 'opencode']),
    source: z.enum(['native', 'runtime']),
    sourceSessionId: z.string(),
    sourceKey: z.string(),
    observationKey: z.string().nullable().optional(),
    channel: z.string(),
    sourceOrder: z.number().int().nonnegative(),
    occurredAt: z.number(),
    ingestedAt: z.number(),
    rawType: z.string(),
    payload: z.unknown(),
    ingestSchemaVersion: z.number().int().positive()
})
```

Also re-export from `shared/src/index.ts` and `shared/src/types.ts`.

- [ ] **Step 4: Re-run the focused shared tests**

Run:

```bash
bun test shared/src/canonical.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/canonical.ts shared/src/canonical.test.ts shared/src/index.ts shared/src/types.ts
git commit -m "feat(shared): add canonical message protocol contracts"
```

### Task 2: Extend shared sync/socket contracts to canonical realtime + additive runtime raw ingest

**Files:**
- Modify: `shared/src/schemas.ts`
- Modify: `shared/src/socket.ts`
- Modify: `shared/src/schemas.test.ts`

- [ ] **Step 1: Add failing tests for canonical sync events and the additive runtime raw-ingest socket payload**

Add tests that assert:
- `SyncEventSchema` accepts `canonical-root-upsert` and `canonical-reset`
- the new runtime raw-ingest payload requires a raw envelope payload
- the old socket `message` path is still left alone in this chunk so intermediate commits keep compiling

```ts
expect(SyncEventSchema.parse({
    type: 'canonical-root-upsert',
    sessionId: 'session-1',
    generation: 2,
    parserVersion: 1,
    streamSeq: 7,
    op: 'append',
    root: validCanonicalRoot
})).toBeTruthy()

expect(() => RuntimeRawEventPayloadSchema.parse({
    sid: 'session-1',
    event: { provider: 'claude', source: 'runtime' }
})).toThrow(/sourceKey/i)
```

- [ ] **Step 2: Run the focused shared test suite and verify failure**

Run:

```bash
bun test shared/src/schemas.test.ts shared/src/canonical.test.ts
```

Expected: FAIL because the shared sync/socket schemas still only know about `message-received` and there is no additive runtime raw-ingest schema yet.

- [ ] **Step 3: Implement the new contracts**

Required changes:
- add canonical sync-event variants to `SyncEventSchema`
- keep existing session/machine/toast/heartbeat events
- define an additive runtime raw-ingest socket payload schema in `shared/src/socket.ts`
- add a new CLI socket event name such as `runtime-event` for the raw-envelope path
- do **not** delete or retarget the old `message` contract in this chunk; Chunk 4 moves producers/consumers over

Minimum schema shape:

```ts
export const RuntimeRawEventPayloadSchema = z.object({
    sid: z.string().min(1),
    event: RawEventEnvelopeSchema.omit({ sessionId: true }).extend({
        source: z.literal('runtime')
    })
})
```

- [ ] **Step 4: Re-run the focused shared tests and one cross-workspace typecheck**

Run:

```bash
bun test shared/src/schemas.test.ts shared/src/canonical.test.ts
bun typecheck
```

Expected:
- focused tests PASS
- typecheck PASS because the old socket event contract is still intact until Chunk 4

- [ ] **Step 5: Commit**

```bash
git add shared/src/schemas.ts shared/src/socket.ts shared/src/schemas.test.ts
git commit -m "feat(shared): add canonical sync and runtime raw-ingest schemas"
```

## Chunk 2: Hub persistence foundation

### Task 3: Add immutable raw-event storage and reset-on-schema-change behavior

**Files:**
- Modify: `hub/src/store/index.ts`
- Modify: `hub/src/store/types.ts`
- Create: `hub/src/store/rawEvents.ts`
- Create: `hub/src/store/rawEventStore.ts`
- Create: `hub/src/store/rawEventStore.test.ts`

- [ ] **Step 1: Write the failing raw-event store test first**

Cover:
- idempotent ingest on `(provider, source, sourceSessionId, sourceKey)`
- monotonic `ingest_seq` for CLI backfill only
- parser replay order follows the spec raw sort key, not ingest order
- a persisted sort identity exists so late earlier events can be detected reliably

```ts
const first = store.rawEvents.ingest({ ...event, sessionId: 's1' })
const second = store.rawEvents.ingest({ ...event, sessionId: 's1' })
expect(first.inserted).toBe(true)
expect(second.inserted).toBe(false)
expect(store.rawEvents.listBySession('s1')).toHaveLength(1)
expect(store.rawEvents.listBySession('s1')[0]?.ingestSeq).toBe(1)
expect(store.rawEvents.listForParserReplay('s1').map((row) => row.id)).toEqual(['earlier', 'later'])
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
bun test hub/src/store/rawEventStore.test.ts
```

Expected: FAIL because `store.rawEvents` and `raw_events` table do not exist.

- [ ] **Step 3: Implement `raw_events` and simplify schema handling**

In `hub/src/store/index.ts`:
- bump schema version
- add `raw_events` table
- expose `rawEvents: RawEventStore`
- do **not** write a migration path from pre-canonical DB versions; fail with a clear reset error instead

Suggested table skeleton:

```sql
CREATE TABLE raw_events (
    ingest_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    source TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    observation_key TEXT,
    channel TEXT NOT NULL,
    source_order INTEGER NOT NULL,
    occurred_at INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL,
    raw_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    ingest_schema_version INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_raw_events_identity
ON raw_events(provider, source, source_session_id, source_key);
CREATE INDEX idx_raw_events_session_ingest_seq
ON raw_events(session_id, ingest_seq);
```

In `hub/src/store/rawEvents.ts` / `rawEventStore.ts`:
- insert-or-return-existing
- list by session ordered by ingest seq
- list ordered for parser replay using the spec total ordering rule
- list runtime events after an ingest cursor for CLI backfill

- [ ] **Step 4: Re-run the focused raw-event store test**

Run:

```bash
bun test hub/src/store/rawEventStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hub/src/store/index.ts hub/src/store/types.ts hub/src/store/rawEvents.ts hub/src/store/rawEventStore.ts hub/src/store/rawEventStore.test.ts
git commit -m "feat(hub): add immutable raw event storage"
```

### Task 4: Add canonical block, parse-state, and staged-child stores

**Files:**
- Modify: `hub/src/store/index.ts`
- Modify: `hub/src/store/types.ts`
- Create: `hub/src/store/canonicalBlocks.ts`
- Create: `hub/src/store/canonicalBlockStore.ts`
- Create: `hub/src/store/canonicalBlockStore.test.ts`
- Create: `hub/src/store/sessionParseState.ts`
- Create: `hub/src/store/sessionParseStateStore.ts`
- Create: `hub/src/store/sessionParseStateStore.test.ts`
- Create: `hub/src/store/stagedChildRawEvents.ts`
- Create: `hub/src/store/stagedChildRawEventStore.ts`
- Create: `hub/src/store/stagedChildRawEventStore.test.ts`

- [ ] **Step 1: Write failing tests for generation-pinned canonical pagination and staged child rehome**

Minimum assertions:
- canonical roots page by `(generation, timelineSeq)` and include inline children
- parse state stores `activeGeneration`, `parserVersion`, `lastProcessedRawSortKey`, `lastProcessedRawEventId`, `latestStreamSeq`, `rebuildRequired`
- staged child raw rows can be atomically rehomed to a parent session

```ts
store.canonicalBlocks.replaceGeneration('s1', 3, [rootA, rootB])
const page = store.canonicalBlocks.getRootsPage('s1', { generation: 3, beforeTimelineSeq: null, limit: 1 })
expect(page.items[0]?.id).toBe(rootA.id)
expect(page.page.nextBeforeTimelineSeq).toBe(2)

store.stagedChildRawEvents.stage(childRaw)
store.stagedChildRawEvents.rehomeToSession({ childIdentity: 'agent-1', sessionId: 's1' })
expect(store.stagedChildRawEvents.listAll()).toHaveLength(0)
expect(store.rawEvents.listBySession('s1')).toHaveLength(1)
```

- [ ] **Step 2: Run the focused store tests and confirm failure**

Run:

```bash
bun test \
  hub/src/store/canonicalBlockStore.test.ts \
  hub/src/store/sessionParseStateStore.test.ts \
  hub/src/store/stagedChildRawEventStore.test.ts
```

Expected: FAIL because those tables/stores do not exist yet.

- [ ] **Step 3: Implement the storage primitives**

Add these tables:

```sql
CREATE TABLE canonical_blocks (
    id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    timeline_seq INTEGER NOT NULL,
    sibling_seq INTEGER NOT NULL,
    parent_block_id TEXT,
    root_block_id TEXT NOT NULL,
    depth INTEGER NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    state TEXT NOT NULL,
    payload TEXT NOT NULL,
    source_raw_event_ids TEXT NOT NULL,
    parser_version INTEGER NOT NULL,
    PRIMARY KEY (session_id, generation, id)
);

CREATE TABLE session_parse_state (
    session_id TEXT PRIMARY KEY,
    parser_version INTEGER NOT NULL,
    active_generation INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    last_processed_raw_sort_key TEXT,
    last_processed_raw_event_id TEXT,
    latest_stream_seq INTEGER NOT NULL,
    rebuild_required INTEGER NOT NULL,
    last_rebuild_started_at INTEGER,
    last_rebuild_completed_at INTEGER
);

CREATE TABLE staged_child_raw_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    child_identity TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    staged_at INTEGER NOT NULL
);
```

Store responsibilities:
- canonical store writes full generations and pages roots oldest→newest within the requested window
- parse-state store is tiny and boring; no parser logic here
- staged-child store only stages / rehomes / deletes

- [ ] **Step 4: Re-run the focused store tests**

Run:

```bash
bun test \
  hub/src/store/canonicalBlockStore.test.ts \
  hub/src/store/sessionParseStateStore.test.ts \
  hub/src/store/stagedChildRawEventStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  hub/src/store/index.ts \
  hub/src/store/types.ts \
  hub/src/store/canonicalBlocks.ts \
  hub/src/store/canonicalBlockStore.ts \
  hub/src/store/canonicalBlockStore.test.ts \
  hub/src/store/sessionParseState.ts \
  hub/src/store/sessionParseStateStore.ts \
  hub/src/store/sessionParseStateStore.test.ts \
  hub/src/store/stagedChildRawEvents.ts \
  hub/src/store/stagedChildRawEventStore.ts \
  hub/src/store/stagedChildRawEventStore.test.ts

git commit -m "feat(hub): add canonical block and parser state stores"
```

## Chunk 3: Hub parser and rebuild engine

### Task 5: Build the deterministic canonical parser with fixture-driven provider coverage

**Files:**
- Create: `hub/src/canonical/parser.ts`
- Create: `hub/src/canonical/parser.test.ts`
- Create: `hub/src/canonical/providerParsers/claude.ts`
- Create: `hub/src/canonical/providerParsers/codex.ts`
- Create: `hub/src/canonical/providerParsers/fallback.ts`

- [ ] **Step 1: Write failing parser fixtures for Claude, Codex, and fallback paths**

Cover these cases explicitly:
- Claude: user text, inline/explicit reasoning, tool-call/result pairing, explicit child task linkage
- Codex: reasoning delta merge, function-call/output pairing, `token_count → event.token-count`, `plan-updated`
- cross-source observation merge: shared `observationKey` collapses runtime/native observations into one logical root with `obs:` anchor identity and native-field precedence
- closed event upgrades: `title-changed`, `compact`, `microcompact`, `turn-duration`, `api-error`
- subagent negative case: without explicit parent-child evidence the timeline stays flat
- Unknown/unsupported payloads from Gemini/Cursor/OpenCode fall back visibly to `fallback-raw`

```ts
const result = parseSessionRawEvents({
    sessionId: 's1',
    parserVersion: 1,
    rawEvents: claudeFixture
})
expect(result.roots.map((root) => root.kind)).toEqual([
    'user-text',
    'reasoning',
    'agent-text',
    'tool-call',
    'subagent-root'
])
expect(findTool(result.roots, 'toolu_123')?.payload.state).toBe('completed')
expect(findFallback(result.roots)?.payload.rawType).toBe('cursor-system')
```

- [ ] **Step 2: Run the parser tests and confirm failure**

Run:

```bash
bun test hub/src/canonical/parser.test.ts
```

Expected: FAIL because the parser modules do not exist yet.

- [ ] **Step 3: Implement the closed v1 parser logic**

Implementation rules:
- total raw order = `occurredAt`, `source rank`, `channel`, `sourceOrder`, `sourceKey`, `id`
- explicit block identity = `anchorIdentity + canonicalPath`
- cross-source observation merge must honor the closed v1 contract: shared `observationKey`, `obs:` anchor, native-over-runtime field precedence, structural change => rebuild
- reasoning/text streams update in place while keeping block ids stable
- tool results update matched tool calls; orphan results become `tool-result`
- subagent roots only appear with explicit evidence from the spec
- only the closed v1 event subtype set upgrades to `event`; unsupported events become `fallback-raw`

Keep the parser interface simple:

```ts
export function parseSessionRawEvents(input: {
    sessionId: string
    parserVersion: number
    rawEvents: RawEventEnvelope[]
    previousState?: SessionParserState | null
}): {
    roots: CanonicalRootBlock[]
    nextState: SessionParserState
    emittedOps: CanonicalRealtimeOp[]
    rebuildRequired: boolean
}
```

- [ ] **Step 4: Re-run the parser fixture tests**

Run:

```bash
bun test hub/src/canonical/parser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  hub/src/canonical/parser.ts \
  hub/src/canonical/parser.test.ts \
  hub/src/canonical/providerParsers/claude.ts \
  hub/src/canonical/providerParsers/codex.ts \
  hub/src/canonical/providerParsers/fallback.ts

git commit -m "feat(hub): add deterministic canonical parser"
```

### Task 6: Add rebuild execution and generation cutover semantics

**Files:**
- Create: `hub/src/canonical/rebuild.ts`
- Create: `hub/src/canonical/rebuild.test.ts`
- Create: `hub/src/sync/canonicalPipeline.integration.test.ts`
- Modify: `hub/src/sync/messageService.ts`
- Modify: `hub/src/sync/syncEngine.ts`

- [ ] **Step 1: Write failing integration tests for incremental ingest, rebuild, and late-arrival reset**

Cover:
- incremental ingest and full rebuild converge to identical canonical output
- earlier late-arriving event marks session rebuild-required and yields a new generation
- `latestStreamSeq` and active generation advance only after successful cutover
- post-snapshot raw events are queued, replayed after cutover when safe, and force one more rebuild when the queued event sorts earlier than the snapshot boundary

```ts
const initial = await service.ingestRawEvents('s1', orderedEvents)
const rebuilt = await rebuildSessionCanonicalState('s1')
expect(rebuilt.activeGeneration).toBe(initial.activeGeneration + 1)
expect(service.getCanonicalMessagesPage('s1', { generation: rebuilt.activeGeneration, beforeTimelineSeq: null, limit: 50 }).items)
    .toEqual(rebuilt.roots)
```

- [ ] **Step 2: Run the focused canonical pipeline tests and verify failure**

Run:

```bash
bun test \
  hub/src/canonical/rebuild.test.ts \
  hub/src/sync/canonicalPipeline.integration.test.ts
```

Expected: FAIL because rebuild/generation orchestration is not implemented.

- [ ] **Step 3: Implement rebuild + service orchestration**

In `hub/src/canonical/rebuild.ts`:
- snapshot raw-event boundary at rebuild start
- parse into a fresh generation
- keep prior generation readable until the new one is fully written
- cut over `activeGeneration` atomically
- queue post-snapshot arrivals and immediately schedule another rebuild when any queued row sorts earlier than the snapshot boundary

In `hub/src/sync/messageService.ts`:
- add `ingestRawEvents(...)`
- add additive canonical read methods such as `getCanonicalMessagesPage(...)` / `getCanonicalLatestStreamSeq(...)` without deleting the legacy route-facing methods yet
- publish realtime ops from parser output
- emit `canonical-reset` when generation flips or a late earlier event forces reset

- [ ] **Step 4: Re-run the focused canonical pipeline tests and one full typecheck**

Run:

```bash
bun test \
  hub/src/canonical/rebuild.test.ts \
  hub/src/sync/canonicalPipeline.integration.test.ts
bun typecheck
```

Expected:
- focused tests PASS
- typecheck PASS because public route consumers still use the old methods until Chunk 5

- [ ] **Step 5: Commit**

```bash
git add \
  hub/src/canonical/rebuild.ts \
  hub/src/canonical/rebuild.test.ts \
  hub/src/sync/canonicalPipeline.integration.test.ts \
  hub/src/sync/messageService.ts \
  hub/src/sync/syncEngine.ts

git commit -m "feat(hub): add canonical rebuild and generation cutover"
```

## Chunk 4: Runtime and native ingestion cutover

### Task 7: Convert runtime session traffic and CLI backfill to raw envelopes

**Files:**
- Modify: `cli/src/api/apiSession.ts`
- Modify: `hub/src/socket/handlers/cli/sessionHandlers.ts`
- Modify: `hub/src/web/routes/cli.ts`
- Create: `hub/src/socket/handlers/cli/sessionHandlers.test.ts`
- Create: `hub/src/web/routes/cli.test.ts`
- Modify: `cli/src/api/apiSession.test.ts`

- [ ] **Step 1: Write failing tests for runtime raw-ingest and CLI backfill**

Test expectations:
- `ApiSessionClient.sendClaudeSessionMessage(...)` / `sendCodexMessage(...)` send raw runtime envelopes over the additive `runtime-event` path, not UI-shaped role/content wrappers
- hub socket handler ingests those envelopes into `raw_events`
- the `sendCodexMessage(...)` path preserves the real runtime provider (`codex | gemini | cursor | opencode`) and emits `observationKey` whenever upstream data exposes a stable logical event id
- CLI `/cli/sessions/:id/messages` backfills user-visible outbound messages from raw-event ingest cursor

```ts
expect(socketEmit).toHaveBeenCalledWith('runtime-event', {
    sid: 'session-1',
    event: expect.objectContaining({
        source: 'runtime',
        provider: 'claude',
        sourceKey: expect.any(String),
        rawType: 'assistant'
    })
})

const response = await app.request('/cli/sessions/session-1/messages?afterSeq=0')
expect(await response.json()).toEqual({
    messages: [expect.objectContaining({ content: expect.objectContaining({ role: 'user' }) })]
})
```

- [ ] **Step 2: Run the focused runtime/CLI tests and confirm failure**

Run:

```bash
bun test \
  cli/src/api/apiSession.test.ts \
  hub/src/socket/handlers/cli/sessionHandlers.test.ts \
  hub/src/web/routes/cli.test.ts
```

Expected: FAIL because runtime traffic still uses the old `content` envelope and CLI backfill still depends on legacy message seq rows.

- [ ] **Step 3: Implement the runtime raw path**

Required behavior:
- `ApiSessionClient` wraps outgoing runtime events in shared raw-envelope types
- `sendCodexMessage(...)` must key provider from session flavor so Codex/Gemini/Cursor/OpenCode do not collapse into one fake provider
- derive stable runtime `sourceKey` from provider-native ids when available, otherwise from session-scoped seq + event kind
- derive `observationKey` from provider-native logical ids (`uuid`, `call_id`, `response_id`, etc.) whenever available so runtime/native observations can merge later
- keep CLI-facing outbound user delivery working by reading the relevant raw/runtime rows after an ingest cursor and converting only those rows back to user-message content for CLI consumption
- `sessionHandlers.ts` calls `messageService.ingestRawEvents(...)` instead of `store.messages.addMessage(...)`

Use a tiny runtime sequence helper, not a second parser:

```ts
private runtimeSourceOrder = 0

private nextRuntimeEnvelope(partial: Omit<RawEventEnvelope, 'id' | 'sessionId' | 'ingestedAt' | 'sourceOrder'>): RuntimeRawEventPayload {
    this.runtimeSourceOrder += 1
    return {
        sid: this.sessionId,
        event: {
            ...partial,
            source: 'runtime',
            sourceOrder: this.runtimeSourceOrder,
            ingestedAt: Date.now()
        }
    }
}
```

- [ ] **Step 4: Re-run the focused runtime/CLI tests**

Run:

```bash
bun test \
  cli/src/api/apiSession.test.ts \
  hub/src/socket/handlers/cli/sessionHandlers.test.ts \
  hub/src/web/routes/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  cli/src/api/apiSession.ts \
  cli/src/api/apiSession.test.ts \
  hub/src/socket/handlers/cli/sessionHandlers.ts \
  hub/src/socket/handlers/cli/sessionHandlers.test.ts \
  hub/src/web/routes/cli.ts \
  hub/src/web/routes/cli.test.ts

git commit -m "feat(runtime): ingest runtime traffic as raw canonical events"
```

### Task 8: Convert native sync import to raw-event batches

**Files:**
- Modify: `cli/src/nativeSync/types.ts`
- Modify: `cli/src/nativeSync/providers/provider.ts`
- Modify: `cli/src/nativeSync/providers/claude.ts`
- Modify: `cli/src/nativeSync/providers/codex.ts`
- Modify: `cli/src/claude/utils/nativeLogReader.ts`
- Modify: `cli/src/codex/utils/nativeEventReader.ts`
- Modify: `cli/src/nativeSync/NativeSyncService.ts`
- Modify: `cli/src/api/api.ts`
- Modify: `hub/src/web/routes/cliNative.ts`
- Modify: `cli/src/nativeSync/providers/claude.test.ts`
- Modify: `cli/src/nativeSync/providers/codex.test.ts`
- Modify: `cli/src/nativeSync/NativeSyncService.test.ts`
- Modify: `hub/src/web/routes/cliNative.test.ts`

- [ ] **Step 1: Write failing native-sync tests around raw batches**

Cover:
- native providers return raw events with stable `channel`, `sourceOrder`, `sourceKey`, `occurredAt`, `rawType`
- native providers emit `observationKey` whenever a runtime/native merge target exists
- malformed source rows become `ingest-error` raw events instead of being silently dropped
- `NativeSyncService` uploads raw event batches, not `content` messages
- hub native route validates the raw-envelope payloads

```ts
expect(batch.events[0]).toMatchObject({
    source: 'native',
    provider: 'claude',
    sourceKey: 'line:1',
    channel: expect.stringContaining('claude:file:'),
    sourceOrder: 1,
    rawType: 'assistant'
})
expect(batch.events.find((event) => event.rawType === 'ingest-error')).toBeTruthy()

expect(api.importNativeRawEvents).toHaveBeenCalledWith('session-1', expect.arrayContaining([
    expect.objectContaining({ provider: 'codex', source: 'native' })
]))
```

- [ ] **Step 2: Run the focused native-sync tests and confirm failure**

Run:

```bash
bun test \
  cli/src/nativeSync/providers/claude.test.ts \
  cli/src/nativeSync/providers/codex.test.ts \
  cli/src/nativeSync/NativeSyncService.test.ts \
  hub/src/web/routes/cliNative.test.ts
```

Expected: FAIL because native sync still uploads UI-shaped message payloads.

- [ ] **Step 3: Implement native raw-event batching**

Changes:
- provider batch type becomes `events: RawEventEnvelope[]`
- Claude provider uses line number as `sourceOrder` and line-based `sourceKey`
- Codex provider uses line number plus stable event ids where available
- both providers populate `observationKey` when source data includes a stable logical event identity
- malformed lines/records are surfaced as `rawType = 'ingest-error'` envelopes with preview/error metadata
- `cliNative` route hands the events directly to `messageService.ingestRawEvents(...)`
- keep native session upsert timestamp logic unchanged from the previous native time semantics work

- [ ] **Step 4: Re-run the focused native-sync tests**

Run:

```bash
bun test \
  cli/src/nativeSync/providers/claude.test.ts \
  cli/src/nativeSync/providers/codex.test.ts \
  cli/src/nativeSync/NativeSyncService.test.ts \
  hub/src/web/routes/cliNative.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  cli/src/nativeSync/types.ts \
  cli/src/nativeSync/providers/provider.ts \
  cli/src/nativeSync/providers/claude.ts \
  cli/src/nativeSync/providers/codex.ts \
  cli/src/claude/utils/nativeLogReader.ts \
  cli/src/codex/utils/nativeEventReader.ts \
  cli/src/nativeSync/NativeSyncService.ts \
  cli/src/api/api.ts \
  hub/src/web/routes/cliNative.ts \
  cli/src/nativeSync/providers/claude.test.ts \
  cli/src/nativeSync/providers/codex.test.ts \
  cli/src/nativeSync/NativeSyncService.test.ts \
  hub/src/web/routes/cliNative.test.ts

git commit -m "feat(native-sync): import native sessions through raw event batches"
```

## Chunk 5: Public API, realtime, and web renderer cutover

### Task 9: Switch `/sessions/:id/messages`, SSE, and web windowing to canonical roots

**Files:**
- Modify: `hub/src/web/routes/messages.ts`
- Create: `hub/src/web/routes/messages.test.ts`
- Modify: `hub/src/sse/sseManager.ts`
- Modify: `hub/src/sse/sseManager.test.ts`
- Modify: `hub/src/sync/eventPublisher.ts`
- Modify: `hub/src/notifications/notificationHub.ts`
- Modify: `hub/src/notifications/notificationHub.test.ts`
- Modify: `hub/src/notifications/eventParsing.ts`
- Modify: `hub/src/notifications/eventParsing.test.ts`
- Modify: `web/src/types/api.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/hooks/queries/useMessages.ts`
- Modify: `web/src/lib/message-window-store.ts`
- Create: `web/src/lib/message-window-store.test.ts`
- Create: `web/src/hooks/useSSE.test.ts`
- Create: `web/src/lib/canonical-realtime.ts`
- Modify: `web/src/hooks/useSSE.ts`
- Modify: `web/src/router.tsx`

- [ ] **Step 1: Write failing route/store tests for canonical pages, upserts, and resets**

Cover:
- `GET /sessions/:id/messages` returns canonical page payload
- the first history read returns one consistency snapshot containing matching `generation + latestStreamSeq`
- the page returns complete root children trees and full page metadata
- old generation requests return `409 { reset: true, generation, parserVersion }`
- web realtime applies only `streamSeq > latestStreamSeq`
- generation mismatch triggers reset/refetch instead of mixing old/new roots
- web store handles `append`, `replace`, and `canonical-reset`
- ready notifications no longer rely on parsing `message-received`

```ts
const res = await app.request('/api/sessions/session-1/messages?generation=1&beforeTimelineSeq=20&limit=10')
expect(res.status).toBe(409)
expect(await res.json()).toEqual({ reset: true, generation: 2, parserVersion: 1 })

store.ingestRealtime({ type: 'canonical-root-upsert', sessionId: 's1', generation: 2, parserVersion: 1, streamSeq: 9, op: 'replace', root })
expect(getMessageWindowState('s1').roots[0]?.id).toBe(root.id)
expect(applyCanonicalRealtimeState(currentState, staleEvent).changed).toBe(false)
```

- [ ] **Step 2: Run the focused API/window tests and confirm failure**

Run:

```bash
bun test \
  hub/src/web/routes/messages.test.ts \
  hub/src/sse/sseManager.test.ts \
  hub/src/notifications/eventParsing.test.ts \
  hub/src/notifications/notificationHub.test.ts \
  web/src/lib/message-window-store.test.ts \
  web/src/hooks/useSSE.test.ts
```

Expected: FAIL because the public route/store still speak `DecryptedMessage[]` and the realtime/notification chain still depends on `message-received`.

- [ ] **Step 3: Implement the canonical public contract end to end**

Changes required:
- `/sessions/:id/messages` uses `generation`, `beforeTimelineSeq`, `limit`
- `MessagesResponse` in web becomes canonical page response
- message window state stores `roots`, `generation`, `latestStreamSeq`, `oldestTimelineSeq`, `hasMore`
- move stream-seq gating and generation-mismatch reset logic into `web/src/lib/canonical-realtime.ts`
- `useSSE.ts` handles `canonical-root-upsert` / `canonical-reset`
- `notificationHub` derives ready notifications from session state transition or canonical reset/cutover logic, not from message content parsing

Suggested window state shape:

```ts
export type MessageWindowState = {
    sessionId: string
    roots: CanonicalRootBlock[]
    generation: number | null
    latestStreamSeq: number
    hasMore: boolean
    oldestTimelineSeq: number | null
    isLoading: boolean
    isLoadingMore: boolean
    warning: string | null
    pendingCount: number
    atBottom: boolean
    rootsVersion: number
}
```

- [ ] **Step 4: Re-run the focused API/window tests**

Run:

```bash
bun test \
  hub/src/web/routes/messages.test.ts \
  hub/src/sse/sseManager.test.ts \
  hub/src/notifications/eventParsing.test.ts \
  hub/src/notifications/notificationHub.test.ts \
  web/src/lib/message-window-store.test.ts \
  web/src/hooks/useSSE.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  hub/src/web/routes/messages.ts \
  hub/src/web/routes/messages.test.ts \
  hub/src/sse/sseManager.ts \
  hub/src/sse/sseManager.test.ts \
  hub/src/sync/eventPublisher.ts \
  hub/src/notifications/notificationHub.ts \
  hub/src/notifications/notificationHub.test.ts \
  hub/src/notifications/eventParsing.ts \
  hub/src/notifications/eventParsing.test.ts \
  web/src/types/api.ts \
  web/src/api/client.ts \
  web/src/hooks/queries/useMessages.ts \
  web/src/lib/message-window-store.ts \
  web/src/lib/message-window-store.test.ts \
  web/src/lib/canonical-realtime.ts \
  web/src/hooks/useSSE.ts \
  web/src/hooks/useSSE.test.ts \
  web/src/router.tsx

git commit -m "feat(messages): serve and sync canonical timeline roots"
```

### Task 10: Replace the web-side semantic parser with thin canonical render adapters

**Files:**
- Modify: `web/src/chat/types.ts`
- Create: `web/src/chat/canonical.ts`
- Create: `web/src/chat/canonical.test.ts`
- Modify: `web/src/components/SessionChat.tsx`
- Modify: `web/src/lib/assistant-runtime.ts`
- Modify: `web/src/components/AssistantChat/messages/ToolMessage.tsx`
- Create: `web/src/components/chat/SubagentCard.tsx`
- Create: `web/src/components/chat/FallbackRawCard.tsx`
- Modify: `web/src/components/assistant-ui/reasoning.tsx`
- Create: `web/src/components/assistant-ui/reasoning.test.tsx`
- Modify: `web/src/components/ToolCard/ToolCard.tsx`
- Modify: `web/src/components/SessionChat.test.tsx`
- Delete: `web/src/chat/normalize.ts`
- Delete: `web/src/chat/normalizeAgent.ts`
- Delete: `web/src/chat/normalizeUser.ts`
- Delete: `web/src/chat/reducer.ts`
- Delete: `web/src/chat/reducerCliOutput.ts`
- Delete: `web/src/chat/reducerEvents.ts`
- Delete: `web/src/chat/reducerTimeline.ts`
- Delete: `web/src/chat/reducerTools.ts`
- Delete: `web/src/chat/reconcile.ts`
- Delete: `web/src/chat/tracer.ts`
- Delete: `web/src/components/ToolCard/views/CodexReasoningView.tsx`

- [ ] **Step 1: Write failing web tests for reasoning/subagent/fallback rendering**

Cover:
- reasoning is closed by default and does not auto-open while streaming
- explicit `subagent-root` renders a dedicated container with nested children
- orphan/standalone `tool-result` stays visible after adapter conversion
- `fallback-raw` is visible with provider/raw-type labels
- no test imports `normalize*` or `reducer*` after the cutover

```tsx
render(<SessionChat {...props} roots={[reasoningRoot, subagentRoot, fallbackRoot]} />)
expect(screen.getByRole('button', { name: /Reasoning/i })).toHaveAttribute('aria-expanded', 'false')
expect(screen.getByText(/Subagent/i)).toBeInTheDocument()
expect(screen.getByText(/fallback-raw/i)).toBeInTheDocument()
```

- [ ] **Step 2: Run the focused web tests and confirm failure**

Run:

```bash
bun test \
  web/src/chat/canonical.test.ts \
  web/src/components/assistant-ui/reasoning.test.tsx \
  web/src/components/SessionChat.test.tsx
```

Expected: FAIL because the web still relies on normalize/reducer parsing and Codex reasoning special-casing.

- [ ] **Step 3: Implement the thin canonical render layer**

Rules:
- `web/src/chat/canonical.ts` only adapts canonical roots to render blocks; no provider-specific parsing
- `assistant-runtime.ts` may still use assistant-ui tool artifacts, but subagent/fallback rendering must key off canonical artifact kinds, not provider heuristics
- `ReasoningGroup` starts closed and stays closed while streaming unless the user clicks open
- `ToolCard` should stop assuming `Task` means subagent tree ownership

Suggested adapter shape:

```ts
export type RenderBlock =
    | { kind: 'user-text'; id: string; createdAt: number; text: string; localId: string | null }
    | { kind: 'agent-text'; id: string; createdAt: number; text: string }
    | { kind: 'reasoning'; id: string; createdAt: number; text: string; state: 'streaming' | 'completed' }
    | { kind: 'tool-call'; id: string; createdAt: number; toolName: string; state: 'pending' | 'running' | 'completed' | 'error'; children: RenderBlock[] }
    | { kind: 'tool-result'; id: string; createdAt: number; toolName: string | null; payload: unknown }
    | { kind: 'event'; id: string; createdAt: number; subtype: CanonicalEventSubtype; payload: Record<string, unknown> }
    | { kind: 'subagent-root'; id: string; createdAt: number; title: string | null; state: string; children: RenderBlock[] }
    | { kind: 'fallback-raw'; id: string; createdAt: number; provider: string; rawType: string; previewJson: string }

export function canonicalRootsToRenderBlocks(roots: CanonicalRootBlock[]): RenderBlock[] {
    return roots.map((root) => adaptCanonicalBlock(root))
}
```

- [ ] **Step 4: Re-run the focused web tests**

Run:

```bash
bun test \
  web/src/chat/canonical.test.ts \
  web/src/components/assistant-ui/reasoning.test.tsx \
  web/src/components/SessionChat.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  web/src/chat/types.ts \
  web/src/chat/canonical.ts \
  web/src/chat/canonical.test.ts \
  web/src/components/SessionChat.tsx \
  web/src/lib/assistant-runtime.ts \
  web/src/components/AssistantChat/messages/ToolMessage.tsx \
  web/src/components/chat/SubagentCard.tsx \
  web/src/components/chat/FallbackRawCard.tsx \
  web/src/components/assistant-ui/reasoning.tsx \
  web/src/components/assistant-ui/reasoning.test.tsx \
  web/src/components/ToolCard/ToolCard.tsx \
  web/src/components/SessionChat.test.tsx

git rm \
  web/src/chat/normalize.ts \
  web/src/chat/normalizeAgent.ts \
  web/src/chat/normalizeUser.ts \
  web/src/chat/reducer.ts \
  web/src/chat/reducerCliOutput.ts \
  web/src/chat/reducerEvents.ts \
  web/src/chat/reducerTimeline.ts \
  web/src/chat/reducerTools.ts \
  web/src/chat/reconcile.ts \
  web/src/chat/tracer.ts \
  web/src/components/ToolCard/views/CodexReasoningView.tsx

git commit -m "feat(web): render canonical message timeline directly"
```

### Task 11: Remove dead hub message-row code and run full verification

**Files:**
- Modify: `hub/src/store/index.ts`
- Delete: `hub/src/store/messages.ts`
- Delete: `hub/src/store/messageStore.ts`
- Modify: any remaining imports/tests that still reference `store.messages`

- [ ] **Step 1: Add one failing grep-based safety check in the implementation branch**

Before deleting, verify there are no remaining compile-time references to `store.messages` except the files you are about to remove.

Run:

```bash
rg -n "store\.messages|MessageStore|messages\.ts" hub/src cli/src web/src
```

Expected: references still exist and must be cleaned up.

- [ ] **Step 2: Delete the dead code and update leftover imports/tests**

Cleanup targets:
- replace any remaining `store.messages` history reads with canonical or raw-event stores
- delete the old message SQL helpers/store files
- update tests such as native import/resume cases to assert canonical pages instead of decrypted rows

- [ ] **Step 3: Run repo-wide verification**

Run:

```bash
bun test
bun typecheck
```

Expected:
- all tests PASS
- typecheck PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy message parsing pipeline"
```

## Review checklist for the implementing agent

- [ ] Every provider/runtime entry path lands in `raw_events`
- [ ] Canonical parser owns reasoning/tool/subagent semantics
- [ ] `/sessions/:id/messages` returns canonical roots, not decrypted message rows
- [ ] `canonical-reset` + `409 reset-required` paths work end to end
- [ ] Reasoning is closed by default and does not auto-open while streaming
- [ ] Explicit subagent roots render without UI inference
- [ ] Unknown events are visible as `fallback-raw`
- [ ] CLI remote-control message delivery/backfill still works
- [ ] Legacy normalize/reducer/message-row history code is gone

Plan complete and saved to `docs/superpowers/plans/2026-03-16-unified-canonical-message-pipeline.md`. Ready to execute?
