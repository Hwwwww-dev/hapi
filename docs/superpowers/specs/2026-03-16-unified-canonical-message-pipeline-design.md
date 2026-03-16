# Unified Canonical Message Pipeline Design

## Background

HAPI current message pipeline is split across too many layers:

- native providers in `cli/src/nativeSync/providers/*` do provider-specific partial parsing
- hub stores mostly raw message payloads via `hub/src/store/messages.ts` and serves them through `hub/src/sync/messageService.ts`
- web re-parses the same data through `web/src/chat/normalize.ts`, `web/src/chat/normalizeAgent.ts`, `web/src/chat/reducerTimeline.ts`, `web/src/chat/reconcile.ts`, and `web/src/lib/assistant-runtime.ts`
- Codex reasoning is still special-cased as a tool view in `web/src/components/ToolCard/views/CodexReasoningView.tsx`
- reasoning UI in `web/src/components/assistant-ui/reasoning.tsx` auto-expands while streaming
- subagent rendering is partially inferred in the reducer layer instead of coming from a single authoritative model

This produces several problems:

1. parsing responsibility is fragmented; native import, runtime messages, pagination, realtime updates, and rendering can diverge
2. provider-specific special cases leak into the web layer
3. reasoning and subagent behavior are not modeled consistently across Claude, Codex, and future flavors
4. unknown events risk being skipped or degraded inconsistently
5. rebuilding parsing behavior after rule changes is hard because raw and rendered semantics are mixed together

The user requirement is explicit:

- reasoning blocks must default to closed
- parsing should be upgraded by learning from `claudecodeui`, but not copied blindly
- all flavors must enter one unified architecture: Claude, Codex, Gemini, Cursor, OpenCode, and HAPI runtime sessions
- DB compatibility is not required; rebuilding from scratch is acceptable
- API compatibility is not required; `/sessions/:id/messages` can be redefined

## Goal

Build one canonical message pipeline for HAPI:

- every message source first lands as raw events
- hub is the only parsing authority
- hub incrementally produces canonical timeline blocks and stores them
- `/sessions/:id/messages` returns canonical timeline data directly
- web becomes a renderer of canonical blocks instead of a primary parser
- reasoning becomes one standard block type across providers and defaults to collapsed
- subagents are modeled as explicit trees
- unknown events are preserved as fallback raw blocks instead of being dropped
- the system supports full rebuild when parsing rules change

## Non-Goals

- no backward compatibility for the old DB schema, old API response shape, or old web parsing chain
- no attempt to preserve the current `DecryptedMessage`-centric rendering contract
- no temporary dual API contract for raw and canonical history
- no provider-specific UI semantics that bypass the canonical pipeline
- no silent dropping of unsupported events for the sake of a cleaner UI

## Agreed Decisions

### Architecture and storage

- backend-led normalization
- raw events and canonical timeline blocks are both stored
- canonical storage granularity is block/timeline, not message-only
- canonical is generated on write/import, with separate full rebuild support
- `/sessions/:id/messages` is redefined to return canonical timeline data directly

### Coverage

- first implementation covers all flavors end to end
- Claude and Codex receive high-fidelity parsing first
- Gemini, Cursor, and OpenCode must still enter the same canonical model and must not bypass it, even if some events initially fall back to raw blocks
- native import and HAPI runtime messages must share the same downstream parser

### UX and semantics

- reasoning is one standard canonical block kind across providers
- Codex reasoning is no longer a special tool concept
- reasoning defaults to collapsed globally
- streaming reasoning does not auto-expand
- reasoning collapse state is not persisted to local storage
- subagents are explicit trees, not inferred purely in the UI
- unknown events always surface as fallback raw cards

### Compatibility stance

- old DB contents can be discarded and rebuilt
- old message API shapes do not need compatibility shims
- current web-side parsing layers can be aggressively simplified or removed after canonical API cutover

## Design Principles

1. **One parser of record** — hub owns parsing semantics; providers only adapt source events into a common raw envelope.
2. **Raw first, canonical second** — raw data is preserved for rebuild, debugging, and future parser improvements.
3. **Stable canonical blocks** — the canonical timeline is directly renderable without semantic guesswork in the web client.
4. **Explicit structure beats inference** — subagents, reasoning, tool state, and event kinds are modeled, not guessed from ad hoc UI heuristics.
5. **Never lose uncertain data** — parseable-but-unsupported provider events degrade to fallback raw blocks; transport-corrupt records are preserved as ingest errors in raw storage.
6. **Incremental by default, rebuildable when needed** — realtime import must stay efficient, but parser upgrades must allow full replay.
7. **Borrow ideas, not architecture debt** — learn from `claudecodeui` line-by-line native reading and explicit subagent loading, but avoid its front-end-heavy semantic reconstruction.

## Lessons Borrowed from ClaudeCodeUI

### Keep

- line-oriented native session reading and import
- explicit subagent/tool extraction instead of treating child activity as opaque text
- clear parse pipeline documentation from source to render
- graceful handling when an agent/tool file or event type is incomplete

### Reject

- pre-assembling provider-specific UI payloads such as `subagentTools` just for one renderer
- making the front end responsible for the main semantic merge step
- keeping reasoning/tool/subagent semantics split across server transforms and UI transforms
- provider-specific rendering contracts that cannot generalize to all flavors

## Current Pain Points in HAPI

### Native import is still shallow

- `cli/src/nativeSync/providers/claude.ts` and `cli/src/nativeSync/providers/codex.ts` already read source files line-by-line, but they still emit provider-specific message shapes instead of a canonical event model
- Codex native conversion in `cli/src/codex/utils/codexEventConverter.ts` produces partially normalized objects, but the final semantic merge still happens later in the web app

### Hub stores message payloads, not authoritative timeline semantics

- `hub/src/store/messages.ts` stores a single `content` payload per message row
- `hub/src/sync/messageService.ts` serves those payloads back almost unchanged
- native import deduplicates by source identity, but the hub still does not persist a full canonical timeline model

### Web remains the real parser

- `web/src/chat/normalize.ts` and `web/src/chat/normalizeAgent.ts` unwrap multiple message formats and convert them into intermediate normalized messages
- `web/src/chat/reducerTimeline.ts` reconstructs timeline semantics such as reasoning blocks, tool state, title changes, and sidechain grouping
- `web/src/lib/assistant-runtime.ts` then reshapes those reduced blocks again for `assistant-ui`

### Reasoning and subagents are still special cases

- reasoning exists both as assistant-ui reasoning parts and as Codex-specific tool rendering
- `web/src/components/assistant-ui/reasoning.tsx` auto-expands reasoning while streaming, which conflicts with the new requirement
- subagent structure is partially inferred from reducer-side groupings instead of coming from a canonical parent/child tree

## Proposed Architecture

The new architecture is a five-layer pipeline:

1. **Source adapters** — convert provider/runtime inputs into a uniform raw event envelope
2. **Raw event store** — persist immutable source facts
3. **Canonical parser** — incrementally build canonical timeline blocks from raw events using session parser state
4. **Canonical read API** — serve block timelines, pagination, and child trees directly from hub
5. **Web renderer** — render block kinds, manage UI state, and stop owning message semantics

### High-Level Flow

`provider/native/runtime -> raw event envelope -> raw_events -> canonical parser -> canonical_blocks -> /sessions/:id/messages -> web renderer`

## Data Model

### Raw event envelope

Every source adapter emits a raw event envelope with these fields:

- `id`
- `sessionId`
- `provider`: `claude | codex | gemini | cursor | opencode`
- `source`: `native | runtime`
- `sourceSessionId`
- `sourceKey`
- `observationKey`
- `channel`
- `sourceOrder`
- `occurredAt`
- `ingestedAt`
- `rawType`
- `payload`
- `ingestSchemaVersion`

Rules:

- `id` is deterministic and rebuild-stable: `sha1(provider + "|" + source + "|" + sourceSessionId + "|" + sourceKey)`
- `provider + source + sourceSessionId + sourceKey` is the raw event uniqueness identity
- `observationKey` is an optional cross-source logical event identity used only for canonical dedupe when the same provider event is observed by both `runtime` and `native`
- `channel` identifies the logical event stream inside a session, for example a native file stream or a runtime socket stream
- `sourceOrder` is a required monotonic integer within a channel; native adapters use line numbers, runtime adapters use emitted sequence numbers, and any source without a natural counter must synthesize one before persistence
- every raw event must persist a finite `occurredAt`; when the source timestamp is missing or unparsable, the adapter uses a backward-only fallback: previous raw event `occurredAt` in the same channel if one exists, otherwise `0`
- fallback `occurredAt` is never rewritten later; same-channel ordering still remains deterministic because `sourceOrder` is part of the total ordering rule
- raw event payload is preserved as ingested and is never replaced by UI-oriented shape changes
- raw events are never deduplicated across `source`; cross-source collapse happens only in canonical parsing via `observationKey` when available
- rebuild changes only canonical outputs and parser state; raw event rows remain authoritative source facts
- source records that cannot be upgraded into a valid semantic envelope still land in `raw_events` as `rawType = ingest-error` with raw text/bytes preview and parse-error metadata, then stop before canonical parsing

### Raw ordering contract

Canonical parsing and rebuild always sort raw events with one total ordering rule inside a session:

1. `occurredAt` ascending
2. `source` rank ascending, with `native = 0` and `runtime = 1`
3. `channel` lexical ascending
4. `sourceOrder` ascending
5. `sourceKey` lexical ascending
6. `id` lexical ascending as the final tie-breaker

This order is the only authority for incremental parsing, rebuild replay, and stable canonical path generation.

### Late-arrival policy

- if a newly ingested raw event sorts after the last processed raw sort key for the active generation, the parser may apply it incrementally
- if a newly ingested raw event sorts before the last processed raw sort key, v1 marks the session `rebuild-required` and performs a full session rebuild into a new generation
- the old generation remains active until that rebuild finishes; v1 does not attempt partial replay from the middle of a generation
- if a late event supplies only cross-source observation merge data for an already-known `observationKey`, the parser may update the existing canonical block incrementally only when the merge is non-structural under the Cross-source observation merge contract

### Cross-source observation merge

When two raw events share the same non-empty `(provider, sourceSessionId, observationKey)`, canonical parsing treats them as two observations of one logical event. The merge contract is closed in v1:

- canonical `anchorIdentity` becomes `obs:` + `provider` + `|` + `sourceSessionId` + `|` + `observationKey`
- block ids use `anchorIdentity` instead of a source-specific raw event id
- `sourceRawEventIds` stores the ordered union of all merged observations
- payload merge precedence is deterministic: native non-empty fields override runtime non-empty fields; runtime fills only fields still missing after native merge
- incremental cross-source merge is allowed only when it does **not** change canonical `kind`, `canonicalPath`, parentage, or ordering fields (`occurredAt`, `timelineSeq`, `siblingSeq`)
- if a newly arrived observation would change any of those structural fields, the session is marked `rebuild-required` and the change is applied only in the next generation
- if `observationKey` is absent, no cross-source collapse happens and each raw event remains independent

### Canonical blocks

Canonical timeline storage is block-based, not message-based.

Each block stores at least:

- `id`
- `sessionId`
- `timelineSeq`
- `siblingSeq`
- `parentBlockId`
- `rootBlockId`
- `depth`
- `kind`
- `createdAt`
- `updatedAt`
- `state`
- `payload`
- `sourceRawEventIds`
- `parserVersion`
- `generation`

Canonical block kinds for the first implementation:

- `user-text`
- `agent-text`
- `reasoning`
- `tool-call`
- `tool-result`
- `event`
- `subagent-root`
- `fallback-raw`

Ordering and identity contracts:

- `timelineSeq` is the unique dense top-level sequence inside one `generation`; it is assigned only from root blocks where `parentBlockId = null`
- pagination is always root-block pagination by `(generation, timelineSeq)`
- descendants inherit their root through `rootBlockId` and are ordered only by `siblingSeq` within the same parent
- `siblingSeq` is the unique dense sequence among one parent's direct children inside one `generation`
- top-level roots use `siblingSeq = 0`
- `timelineSeq` and `siblingSeq` are immutable inside an active generation; renumbering is allowed only when producing a new generation during rebuild
- block ids are stable across rebuild and are generated from `(sessionId, anchorIdentity, canonicalPath)`
- `anchorIdentity` is `obs:<provider>|<sourceSessionId>|<observationKey>` when cross-source collapse applies; otherwise it is the root anchor raw event id
- the root anchor raw event is the first raw event that opened the canonical structure when no `observationKey` anchor exists: opening tool-call event for tools, first reasoning event for reasoning streams, first explicit parent event for subagent roots, and first contributing text/event raw event for one-shot roots
- `canonicalPath` is a slash-separated grammar of `segment = kind ":" stableLocalKey`
- `stableLocalKey` is chosen per kind from explicit semantic identities; if the provider lacks one, the fallback is the first contributing raw event id plus deterministic part index inside that raw event
- later updates never change a block's `canonicalPath`; they mutate the already-located block payload/state in place within the new parse result

Canonical path key table:

- `user-text` / `agent-text`: `<textStreamKey>` when streaming exists, otherwise `<anchorIdentity>.<partIndex>`
- `reasoning`: `<reasoningStreamKey>`
- `tool-call`: `<canonicalToolIdentity>`
- `tool-result`: `<anchorIdentity>`
- `event`: `<eventSubtype>.<anchorIdentity>`
- `subagent-root`: `<childSessionOrAgentIdentity>`
- `fallback-raw`: `<anchorIdentity>`

### Session parser state

Incremental parsing needs a persisted parser state per session. It stores:

- latest processed raw cursor
- open tool calls by tool identity
- open reasoning streams by channel
- parent/child link indexes for subagents
- raw event to emitted block mappings
- `parserVersion`
- `activeGeneration`
- rebuild bookkeeping

This state allows incremental updates without recomputing the entire session on every new event.

## Storage Layout

Replace the current single-layer message storage role with four explicit stores:

### `raw_events`

Purpose: immutable source log.

Required fields:

- session id
- provider/source identity
- source event identity
- timestamps
- raw type
- raw payload JSON
- ingest schema version metadata

### `canonical_blocks`

Purpose: renderable timeline tree.

Required fields:

- session id
- stable block id
- timeline order
- parent/root tree references
- kind/state
- canonical payload JSON
- source raw references
- timestamps

### `session_parse_state`

Purpose: incremental parser state and rebuild progress.

Required fields:

- session id
- parser version
- active generation
- parser state JSON
- last processed raw event identity
- last rebuild metadata

### `staged_child_raw_events`

Purpose: hold child raw streams whose parent HAPI session is not yet resolved.

Required fields:

- provider
- child source session or agent identity
- raw event envelope fields except final parent `sessionId`
- unresolved ownership metadata
- staged-at timestamp

Rules:

- staged child rows are not exposed through `/sessions/:id/messages`
- once parent ownership is resolved, staged rows are atomically rehomed into the parent session's `raw_events` before parent canonical parsing continues
- v1 never exposes staging pseudo-sessions as normal user-visible sessions

## Canonical Block Semantics

### `user-text`

Represents final user-visible user input. Attachments and source metadata belong here if the canonical payload needs them.

### `agent-text`

Represents non-reasoning assistant text intended as visible response content.

### `reasoning`

Represents model reasoning across all providers.

Rules:

- Claude `thinking` blocks map here
- Claude inline `<thinking>...</thinking>` content maps here
- Codex reasoning events and reasoning deltas merge here
- future flavors map their hidden or auxiliary reasoning here when semantically equivalent
- reasoning is not encoded as a tool

### `tool-call`

Represents a tool invocation. Canonical payload carries:

- tool identity
- tool name
- normalized input
- current state: pending/running/completed/error/canceled
- optional result summary
- optional provider metadata

### `tool-result`

`tool-result` is reserved for orphan or explicitly standalone results.

Rules:

- if a result can be matched to an existing tool call, the canonical parser updates the parent `tool-call` block state and result payload and does **not** emit a second visible result block for the same invocation in v1
- `tool-result` is emitted only when a provider delivers a result without an explicit opening call anchor or when the source explicitly models the result as its own visible timeline artifact
- the same source result may never appear both as parent `tool-call.payload.result` and as a separate `tool-result` block in the same generation

### `event`

`event` uses a closed v1 subtype enum. Supported subtypes are:

- `title-changed`
- `compact`
- `microcompact`
- `turn-duration`
- `api-error`
- `token-count`
- `plan-updated`

Any other system-style payload falls back to `fallback-raw` in v1 instead of expanding the enum implicitly.

### `subagent-root`

Represents an explicit child timeline container.

Its payload includes:

- subagent identity if known
- display title/description
- lifecycle state
- provider/source metadata

Its children are stored as canonical blocks in the same table and linked by `parentBlockId`.

### `fallback-raw`

Represents any parseable event that could not be upgraded into a richer canonical kind.

Its payload includes:

- provider
- raw type
- compact summary
- raw payload preview
- source raw references

Parseable unknown data must degrade here instead of being dropped. Transport-corrupt `ingest-error` records stay in raw storage and diagnostics, not in the canonical timeline.

## Parsing Pipeline

### Stage 1: Source adapters

Each provider/runtime adapter only produces raw event envelopes.

Allowed responsibilities:

- discover session files or runtime events
- extract source timestamps
- derive `sourceKey`
- tag provider/source identity
- capture malformed source records into `raw_events` as `ingest-error` and skip only their canonical parse step

Forbidden responsibilities:

- final reasoning semantics
- tool call/result pairing
- subagent tree construction
- special UI contracts
- provider-specific render decisions

### Claude adapter strategy

Claude native and runtime sources provide:

- event type
- message role/content
- `uuid`, `parentUuid`, `isSidechain`
- `toolUseResult.agentId`
- timestamps

Adapters preserve these as raw payload facts. HAPI runtime sessions are not a separate provider; they remain `provider = claude` or `provider = codex` with `source = runtime`.

### Codex adapter strategy

Codex native and runtime sources provide:

- `session_meta`
- `event_msg`
- `response_item`
- reasoning delta events
- function call identities and outputs
- timestamp metadata

Adapters preserve these as raw payload facts with stable `sourceKey` identities.

### Gemini, Cursor, OpenCode strategy

All three must emit raw event envelopes immediately, even before all semantic mappings are rich.

Initial rule:

- if the canonical parser can confidently map the event, emit a rich canonical block
- otherwise emit `fallback-raw`

### Stage 2: Incremental canonical parser

The canonical parser is a session-scoped state machine.

Responsibilities:

- consume newly ingested raw events in source order
- emit or update canonical blocks
- keep stable block identities across incremental parsing and rebuild
- maintain parser state needed for pairing and tree assembly

### Required parser capabilities

#### Tool pairing

- open tool calls are indexed by canonical tool identity
- canonical tool identity derivation in v1 is closed and provider-specific:
  - Claude: `tool_use.id`
  - Codex: normalized first non-empty value from `call_id | callId | tool_call_id | toolCallId | id`
  - runtime wrappers: provider-native call id if present, otherwise `sha1(provider + "|" + sourceSessionId + "|" + anchorRawEventId + "|" + normalizedToolName + "|" + normalizedInputDigest)`
  - orphan results: `orphan:` + `anchorRawEventId`
- later result events update the same tool call block when matched by canonical tool identity; unmatched results become orphan `tool-result` blocks
- out-of-order or delayed result events must still reconcile correctly

#### Reasoning merge

- reasoning delta streams append to the current reasoning block for that logical channel
- reasoning closes when a provider signals completion or when a different content phase begins
- reasoning remains separate from visible assistant response text

#### Text stream assembly

Visible `user-text` and `agent-text` blocks also use a closed stream contract in v1:

- a text block opens on the first visible text chunk for one `(role, textStreamKey)`
- `textStreamKey` is derived from provider message identity plus semantic part slot; if the provider has no chunked text identity, the fallback is `<anchorIdentity>.<partIndex>`
- additional chunks with the same `(role, textStreamKey)` update the existing text block instead of creating a new block
- a text block closes when the provider signals message completion, when a different semantic content kind starts, or when the provider message identity changes
- native final text and runtime chunked text collapse into the same block only when they share the same cross-source `observationKey` and yield the same `textStreamKey`; otherwise they remain separate blocks
- `partIndex` is assigned only for non-streamed text parts, so streamed text never renumbers when more chunks arrive

#### Subagent assembly

The parser creates `subagent-root` only when there is explicit provider evidence for parent-child linkage.

Allowed evidence in v1:

- a parent Task/tool call plus a returned child agent/session identifier on the matching result or metadata
- a provider-native child session record that carries an explicit parent tool/session identifier matching the parent invocation
- an imported child timeline already tagged with the same explicit child agent/session identifier

If these anchors are missing, the parser keeps the data flat and never invents a tree. If that linkage arrives later, v1 does not re-parent blocks in place inside the active generation; it triggers a rebuild into a new generation so canonical ids stay stable per generation.

#### Event upgrade

- only the closed v1 event subtype set is upgraded into `event` blocks
- any system payload outside that closed set degrades to `fallback-raw`

### Stage 3: Full rebuild

A full rebuild replays `raw_events` into `canonical_blocks` from scratch.

Requirements:

- rebuild is session-scoped or global
- rebuild is deterministic for the same parser version and raw input
- rebuild does not mutate raw events
- rebuild captures a snapshot boundary at start: all raw events up to that ordered boundary belong to the current rebuild
- raw events arriving after the snapshot boundary are queued for post-cutover processing and are not merged into the in-flight rebuild generation
- if any queued event sorts before the snapshot boundary, the just-built generation may still cut over, but the session is immediately marked for one additional rebuild generation afterward
- rebuild writes canonical output into a new `generation` while the previous successful generation stays readable
- the hub flips `activeGeneration` only after the new generation is complete and validated, giving rebuild an atomic cutover point
- after cutover, queued post-snapshot events are replayed incrementally against the new active generation when their order permits; otherwise they trigger the next rebuild
- `ingestSchemaVersion` and `parserVersion` are tracked separately; rebuild only changes canonical generations for a chosen `parserVersion`

## Provider-Specific Semantic Targets

### Claude

Claude should reach high-fidelity canonical mapping in the first implementation.

Must support:

- user and assistant text
- explicit and inline thinking/reasoning
- tool call/result pairing
- Task/subagent relationships
- sidechain-related parent-child context only when it carries the explicit subagent evidence defined in the Subagent assembly contract; otherwise it stays flat or falls back
- summary/compact/api-error/turn-duration payloads only through the closed v1 event subtype set, with the rest falling back

### Codex

Codex should also reach high-fidelity canonical mapping in the first implementation.

Must support:

- message text
- reasoning and reasoning deltas merged into standard reasoning blocks
- function call and function call output pairing
- `token_count` maps to `event.token-count`; plan updates map to `event.plan-updated`; unsupported Codex system payloads fall back
- no special CodexReasoning tool semantics in the final timeline

### Gemini, Cursor, OpenCode

These providers must immediately adopt the same pipeline.

First implementation requirement:

- canonical blocks or fallback blocks must exist for all source events
- none of these providers may bypass canonical parsing and render raw payloads directly in the web layer

## API Contract

`GET /sessions/:id/messages` returns canonical timeline data directly.

Request parameters in v1 are fixed:

- `generation` (optional on first page, required on follow-up pages)
- `beforeTimelineSeq`
- `limit`

Response shape:

```ts
{
    items: CanonicalRootBlock[]
    page: {
        generation: number
        parserVersion: number
        latestStreamSeq: number
        limit: number
        beforeTimelineSeq: number | null
        nextBeforeTimelineSeq: number | null
        hasMore: boolean
    }
}
```

Rules:

- pagination is based on root `(generation, timelineSeq)`, not old message seq semantics
- `items` are returned in ascending `timelineSeq` order within the page, i.e. oldest to newest inside that window
- the endpoint always returns full root blocks with their complete inline `children` trees for that page
- children are depth-first ordered by `siblingSeq`
- children are not independently paginated in v1
- pagination cursors are generation-pinned; follow-up page requests must include the same `generation`
- if the client requests an older generation after a rebuild cutover, the API returns `409 reset-required` with the active `generation` and `parserVersion`
- `409 reset-required` response shape in v1 is `{ reset: true, generation, parserVersion }`
- the response no longer returns raw `DecryptedMessage[]`

### Realtime contract

Realtime uses two canonical event shapes in v1:

```ts
{ type: 'canonical-root-upsert', sessionId, generation, parserVersion, streamSeq, op: 'append' | 'replace', root: CanonicalRootBlock }
{ type: 'canonical-reset', sessionId, generation, parserVersion, streamSeq, reason: 'rebuild' | 'parser-version-change' | 'late-earlier-event' }
```

Realtime rules:

- `streamSeq` is a session-scoped monotonic push sequence
- the first history read returns `generation` and `latestStreamSeq` from the same consistency snapshot; the client only applies realtime events with `streamSeq > latestStreamSeq`
- `replace` targets an existing root by `root.id` inside the same generation
- clients merge `canonical-root-upsert` only when `generation` matches the currently loaded generation
- on `canonical-reset`, on any `generation` mismatch, or on `409 reset-required`, the client clears local canonical cache and refetches the first page for the advertised active generation
- v1 never sends child-only partial tree patches

## Web Rendering Model

The web app becomes a canonical block renderer.

### Web responsibilities that remain

- timeline virtualization/windowing
- optimistic UI for local send states
- expand/collapse state
- tool detail presentation
- subagent tree expansion
- realtime and pagination cache management

### Web responsibilities that move to hub

- role/unwrapped envelope detection
- provider-specific semantic parsing
- reasoning extraction
- tool pairing
- title-change inference
- subagent grouping
- fallback decision logic

### Consequence for current files

These areas should become thin adapters or be removed after cutover:

- `web/src/chat/normalize.ts`
- `web/src/chat/normalizeAgent.ts`
- `web/src/chat/reducer*.ts`
- semantic parts of `web/src/lib/assistant-runtime.ts`
- Codex-specific reasoning views under `web/src/components/ToolCard/views/`

## Reasoning UX Rules

Reasoning is rendered from canonical `reasoning` blocks.

Rules:

- reasoning blocks are collapsed by default
- collapse state is not remembered across refreshes
- streaming reasoning does not auto-open
- provider differences do not change this default rule
- the UI may show a compact status indicator for active reasoning, but not the reasoning text unless expanded

Current `web/src/components/assistant-ui/reasoning.tsx` must therefore stop auto-expanding based on streaming state.

## Subagent Model

Subagents are explicit trees.

### Canonical semantics

- `subagent-root` occupies a top-level timeline position
- descendant blocks are linked through `parentBlockId`
- children may include reasoning, tools, events, text, and fallback blocks
- parent block state summarizes child progress but does not replace child history

### Ownership model

Subagent ownership is explicit in v1:

- canonical `sessionId` always remains the parent HAPI session being viewed
- child provider session ids are stored as metadata such as `childSourceSessionId` or `childAgentId`, not as separate top-level canonical sessions for `/sessions/:id/messages`
- imported child timelines are staged and parsed inside the parent session scope once the parent HAPI session is known
- if child events arrive before explicit parent linkage and parent ownership is already known, they may appear as flat provisional roots in the parent session generation; once linkage arrives, the next rebuild generation materializes them under `subagent-root`
- if parent ownership is not yet known, child raw events stay in `staged_child_raw_events` until they can be atomically rehomed into the parent session
- `/sessions/:id/messages` for the parent session never needs a cross-session join in v1; the parent generation is already the authoritative view contract

### Rendering semantics

The subagent container shows:

- agent/title/description
- lifecycle state
- current child activity summary when running
- expandable child timeline
- final completion/error summary when finished

The web layer must not infer subagent structure from provider-specific fields such as `Task` plus ad hoc reducer grouping alone.

## Fallback Policy

Every parseable unrecognized or not-yet-supported event becomes `fallback-raw`.

### Required behavior

- no silent drop
- visible provider and raw type label
- expandable compact JSON preview
- linked raw event identity for debugging and future parser improvement

This is mandatory for all flavors.

## Error Handling and Invariants

### Parsing invariants

- raw event ordering within a session must be deterministic
- canonical block ids must be stable for the same raw input and parser version
- canonical timeline ordering must not depend on UI arrival order
- parser must be idempotent under repeated native import of the same source identities

### Failure handling

- malformed source records are preserved in `raw_events` as `ingest-error` rows with raw preview and error metadata, then skipped by canonical parsing and surfaced only through diagnostics tooling
- parseable provider parsing gaps degrade to `fallback-raw`
- missing child/subagent resources do not break the parent timeline; they produce fallback or partial state, never silent disappearance
- rebuild failures must leave the previous successful canonical generation active until the replacement generation is fully ready

## Migration Strategy

No backward compatibility is required, so the migration strategy is clean replacement.

### Phase 1

Define shared schemas and enums for:

- raw event envelope
- canonical block
- messages API response
- provider/source/block kind metadata

### Phase 2

Add hub storage and services for:

- raw event ingestion
- canonical block storage
- parser state persistence
- rebuild execution

### Phase 3

Implement high-fidelity Claude and Codex mappings, and connect Gemini/Cursor/OpenCode to the same raw/canonical pipeline with fallback-backed canonical visibility before cutover.

### Cutover

One cutover ships the canonical API and canonical web renderer together:

- switch `/sessions/:id/messages` to canonical timeline output
- activate canonical web rendering, including:

- reasoning default collapsed
- unified reasoning view
- subagent tree rendering
- fallback raw cards

### Post-cutover hardening

Richer Gemini, Cursor, and OpenCode mappings beyond the fallback-backed baseline already required before cutover.

## Testing Strategy

### Raw ingest tests

Need fixture-driven tests for:

- idempotent native import
- source key stability
- malformed input rejection
- runtime/native envelope normalization

### Canonical parser tests

Need fixture-driven tests per provider.

Required assertions:

- reasoning extraction and merge
- reasoning delta assembly for Codex
- tool call/result pairing
- title and system event upgrades
- subagent tree creation only when explicit linkage evidence exists
- fallback raw generation for unknown events
- canonical timeline ordering stability

### Rebuild tests

Need to prove:

- rebuild produces the same canonical result for the same raw input and parser version
- block identities remain stable across rebuild
- incremental parsing and full rebuild converge to the same canonical output

### API tests

Need to cover:

- canonical pagination
- child tree return semantics
- realtime append behavior
- cross-provider session rendering through one endpoint

### Web tests

After cutover, web tests should focus on rendering behavior instead of provider parsing.

Required coverage:

- reasoning collapsed by default
- streaming reasoning stays collapsed
- canonical tool rendering
- subagent container rendering from explicit trees
- fallback raw card rendering
- canonical timeline pagination and window updates

## File and Ownership Boundaries

### Shared

Owns canonical schemas and types consumed by CLI, hub, and web.

### CLI/native providers

Own only source discovery and raw envelope emission.

### Hub parser and store

Own raw persistence, canonical parsing, parser state, rebuild, and canonical API reads.

### Web

Own only presentation, interaction state, and lightweight timeline caching.

This separation keeps one semantic source of truth and makes each layer independently understandable and testable.

## Success Criteria

This design is complete when all of the following are true:

1. all flavors enter the same raw and canonical pipeline
2. hub is the only semantic parser of record
3. `/sessions/:id/messages` returns canonical timeline blocks directly
4. web no longer depends on provider-specific semantic parsing to render history correctly
5. reasoning is unified as one canonical block kind and defaults to collapsed for all providers
6. Codex reasoning is no longer represented as a special tool semantic
7. subagents render from explicit canonical trees
8. unknown events remain visible through fallback raw blocks
9. canonical output can be rebuilt deterministically from raw events


## Appendix: Worked Examples

### Example A: Claude tool call and result

Raw events after adapter normalization:

| raw id | source | channel | sourceOrder | occurredAt | rawType | key fields |
|---|---|---:|---:|---:|---|---|
| `r1` | native | `claude:file:main` | 10 | 1000 | `assistant` | `tool_use.id = toolu_123`, `name = Bash` |
| `r2` | native | `claude:file:main` | 11 | 1001 | `user` | `tool_result.tool_use_id = toolu_123` |

Deterministic parse result in generation 7:

- root anchor raw event: `r1`
- canonical tool identity: `toolu_123`
- root canonical path: `tool-call:toolu_123`
- root block id: `sha1(sessionId + r1 + 'tool-call:toolu_123')`
- `timelineSeq = 42`
- `siblingSeq = 0`
- no separate `tool-result` block is emitted because the result matches the existing tool call
- `tool-call.payload.result` is updated from `r2`

Realtime update example:

```ts
{
    type: 'canonical-root-upsert',
    sessionId,
    generation: 7,
    parserVersion: 3,
    streamSeq: 991,
    op: 'replace',
    root: { id: '<tool-call-root-id>', timelineSeq: 42, kind: 'tool-call', children: [] }
}
```

The web client replaces the cached root with the same `root.id` inside generation 7.

### Example B: Codex reasoning delta merge

Raw events after adapter normalization:

| raw id | source | channel | sourceOrder | occurredAt | rawType | key fields |
|---|---|---:|---:|---:|---|---|
| `r10` | native | `codex:file:2026-03-16` | 21 | 2000 | `event_msg` | `agent_reasoning = 'Check parser state'` |
| `r11` | native | `codex:file:2026-03-16` | 22 | 2001 | `event_msg` | `agent_reasoning_delta = ' before rebuild'` |
| `r12` | native | `codex:file:2026-03-16` | 23 | 2002 | `event_msg` | `agent_message = 'Done.'` |

Deterministic parse result in generation 7:

- reasoning stream key: `codex-reasoning:codex:file:2026-03-16:21`
- root anchor raw event: `r10`
- reasoning path: `reasoning:codex-reasoning:codex:file:2026-03-16:21`
- reasoning block id: `sha1(sessionId + r10 + 'reasoning:codex-reasoning:codex:file:2026-03-16:21')`
- `r11` appends text to the same reasoning block and does not create a second block
- `r12` closes the reasoning stream and emits a later `agent-text` root with its own `timelineSeq`

If a newly discovered raw event later sorts before `r10`, generation 7 stays active and the session enters rebuild. The next visible state is a `canonical-reset` event pointing clients at generation 8.


### Example C: Same logical event observed by runtime and native

Two raw observations for one Claude assistant text event:

| raw id | source | sourceKey | observationKey | occurredAt | notes |
|---|---|---|---|---:|---|
| `rr1` | runtime | `socket:msg:17` | `claude:uuid:9d2` | 3000 | realtime observation |
| `rn1` | native | `line:84` | `claude:uuid:9d2` | 3000 | later native log observation |

Rules applied:

- both rows stay in `raw_events` because raw uniqueness includes `source`
- canonical parsing collapses them through shared `observationKey = claude:uuid:9d2`
- the canonical block anchor identity is `obs:claude|<sourceSessionId>|claude:uuid:9d2`, so it does not depend on whether runtime or native arrived first
- when `rn1` arrives later with the same `observationKey`, the parser updates the existing canonical block instead of creating a duplicate root
- because the block anchor/path already exists, this is an incremental `replace`, not a rebuild

### Example D: Child timeline arrives before parent subagent linkage

Observed order:

1. child events for `agent-42` arrive and are emitted as flat roots because no explicit parent linkage exists yet
2. later, a parent Task result arrives with explicit `agentId = agent-42`

Rules applied:

- generation 7 keeps the child events flat; no in-place re-parenting occurs
- the parser marks the session `rebuild-required`
- generation 8 rebuilds from raw events and emits a `subagent-root:agent-42` tree
- clients receive `canonical-reset` for generation 8 and refetch, instead of trying to patch tree structure in place
