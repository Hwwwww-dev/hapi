# Codex Native UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent UX improvements: (1) native sessions shown as sub-items under their parent HAPI session in the list, (2) reasoning blocks default to collapsed, (3) deleted native sessions are blacklisted so they don't re-appear after deletion.

**Architecture:**
- Task 1 (native sub-items): Pure frontend change in `SessionList.tsx` — group sessions by `nativeSessionId` linkage, render native sessions as indented children.
- Task 2 (reasoning collapsed): Remove auto-expand logic from `ReasoningGroup` in `reasoning.tsx`.
- Task 3 (deleted blacklist): Add `deleted_native_aliases` table (schema v7), populate on session delete, check on upsert.

**Tech Stack:** React/TypeScript (web), Bun/SQLite (hub), Vitest (tests)

---

## Chunk 1: Task 2 — Reasoning Default Collapsed

### Task 1: Remove auto-expand from ReasoningGroup

**Files:**
- Modify: `web/src/components/assistant-ui/reasoning.tsx`

- [ ] **Step 1: Read current implementation**

Read `web/src/components/assistant-ui/reasoning.tsx` to confirm current logic.

- [ ] **Step 2: Remove auto-expand useEffect**

In `ReasoningGroup`, remove the `useEffect` that calls `setIsOpen(true)` when `isStreaming` is true. The component should stay collapsed by default and only open/close on user click.

Before:
```tsx
useEffect(() => {
    if (isStreaming) {
        setIsOpen(true)
    }
}, [isStreaming])
```

After: delete the entire `useEffect` block (and the `useEffect` import if no longer used).

- [ ] **Step 3: Verify no other auto-open logic remains**

Confirm `isOpen` state starts as `false` and is only toggled by the button click handler.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/assistant-ui/reasoning.tsx
git commit -m "fix: reasoning blocks default to collapsed, no auto-expand on stream

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

## Chunk 2: Task 3 — Deleted Native Session Blacklist

### Task 2: Add deleted_native_aliases table (schema v7)

**Files:**
- Modify: `hub/src/store/index.ts` — add migration v6→v7, bump SCHEMA_VERSION to 7
- Modify: `hub/src/store/sessions.ts` — add `insertDeletedNativeAlias` and `isNativeAliasDeleted` functions
- Modify: `hub/src/store/types.ts` — add `DeletedNativeAlias` type if needed
- Modify: `hub/src/sync/syncEngine.ts` — call `insertDeletedNativeAlias` on delete, check on upsert

- [ ] **Step 1: Write failing test for blacklist behavior**

In `hub/src/sync/syncEngine.test.ts` (or nearest integration test file), add:

```typescript
it('does not re-create a session whose native alias was deleted', () => {
    // 1. upsert a native session → creates session S1
    // 2. delete S1
    // 3. upsert same native session again
    // 4. expect: no new session created, returns null or throws
})
```

Run: `bun test hub/src/sync/syncEngine.test.ts` — expect FAIL.

- [ ] **Step 2: Add migration v6→v7 in hub/src/store/index.ts**

Change `SCHEMA_VERSION` from `6` to `7`.

Add migration chain entries:
```typescript
if (currentVersion === 6 && SCHEMA_VERSION === 7) {
    this.migrateFromV6ToV7()
    this.setUserVersion(SCHEMA_VERSION)
    return
}
// also add to all existing chains that end at 6:
// e.g. currentVersion === 5 && SCHEMA_VERSION === 7 → migrateFromV5ToV6() + migrateFromV6ToV7()
// etc.
```

Add `migrateFromV6ToV7()` method:
```typescript
private migrateFromV6ToV7(): void {
    this.db.exec(`
        CREATE TABLE IF NOT EXISTS deleted_native_aliases (
            namespace TEXT NOT NULL,
            provider TEXT NOT NULL,
            native_session_id TEXT NOT NULL,
            deleted_at INTEGER NOT NULL,
            PRIMARY KEY (namespace, provider, native_session_id)
        )
    `)
}
```

Also add `'deleted_native_aliases'` to `REQUIRED_TABLES`.

Add `createSchema()` table definition:
```sql
CREATE TABLE IF NOT EXISTS deleted_native_aliases (
    namespace TEXT NOT NULL,
    provider TEXT NOT NULL,
    native_session_id TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, provider, native_session_id)
);
```

- [ ] **Step 3: Add store functions in hub/src/store/sessions.ts**

```typescript
export function insertDeletedNativeAlias(
    db: Database,
    namespace: string,
    provider: 'claude' | 'codex',
    nativeSessionId: string,
    deletedAt: number
): void {
    db.prepare(`
        INSERT OR REPLACE INTO deleted_native_aliases (namespace, provider, native_session_id, deleted_at)
        VALUES (?, ?, ?, ?)
    `).run(namespace, provider, nativeSessionId, deletedAt)
}

export function isNativeAliasDeleted(
    db: Database,
    namespace: string,
    provider: 'claude' | 'codex',
    nativeSessionId: string
): boolean {
    const row = db.prepare(`
        SELECT 1 FROM deleted_native_aliases
        WHERE namespace = ? AND provider = ? AND native_session_id = ?
        LIMIT 1
    `).get(namespace, provider, nativeSessionId)
    return row !== undefined
}
```

- [ ] **Step 4: Expose functions via SessionStore**

In `hub/src/store/sessionStore.ts`, add wrappers:
```typescript
insertDeletedNativeAlias(namespace: string, provider: 'claude' | 'codex', nativeSessionId: string, deletedAt: number): void {
    insertDeletedNativeAlias(this.db, namespace, provider, nativeSessionId, deletedAt)
}

isNativeAliasDeleted(namespace: string, provider: 'claude' | 'codex', nativeSessionId: string): boolean {
    return isNativeAliasDeleted(this.db, namespace, provider, nativeSessionId)
}
```

- [ ] **Step 5: Populate blacklist on session delete in syncEngine.ts**

In `syncEngine.ts`, find `dropSessionIfPresent` (line ~604). Before or after deleting the session, collect its native aliases and write them to the blacklist:

```typescript
private dropSessionIfPresent(sessionId: string, namespace: string): void {
    // Collect native aliases before deletion (CASCADE will remove them)
    const aliases = this.store.sessions.getNativeAliasesForSession(sessionId, namespace)
    const deleted = this.store.sessions.deleteSession(sessionId, namespace)
    if (!deleted) {
        return
    }
    const now = Date.now()
    for (const alias of aliases) {
        this.store.sessions.insertDeletedNativeAlias(namespace, alias.provider, alias.nativeSessionId, now)
    }
    this.sessionCache.refreshSession(sessionId)
}
```

Also handle the public `deleteSession` method (line ~734) — it calls `sessionCache.deleteSession`. Add blacklist population there too:

```typescript
async deleteSession(sessionId: string): Promise<void> {
    // Collect aliases before cache delete removes them
    const session = this.getSession(sessionId)
    if (session?.metadata?.nativeSessionId && session.metadata.nativeProvider) {
        const namespace = session.namespace ?? 'default'
        this.store.sessions.insertDeletedNativeAlias(
            namespace,
            session.metadata.nativeProvider,
            session.metadata.nativeSessionId,
            Date.now()
        )
    }
    await this.sessionCache.deleteSession(sessionId)
}
```

- [ ] **Step 6: Add getNativeAliasesForSession to sessions.ts**

```typescript
export function getNativeAliasesForSession(
    db: Database,
    sessionId: string,
    namespace: string
): Array<{ provider: 'claude' | 'codex'; nativeSessionId: string }> {
    const rows = db.prepare(`
        SELECT provider, native_session_id
        FROM session_native_aliases
        WHERE session_id = ? AND namespace = ?
    `).all(sessionId, namespace) as Array<{ provider: string; native_session_id: string }>
    return rows.map(r => ({
        provider: r.provider as 'claude' | 'codex',
        nativeSessionId: r.native_session_id
    }))
}
```

Expose via `SessionStore`.

- [ ] **Step 7: Check blacklist in upsertNativeSession**

In `syncEngine.ts`, `upsertNativeSession` method (line ~238), after resolving `nativeIdentity`, add early return if blacklisted:

```typescript
upsertNativeSession(payload: { ... }): Session | null {
    const nativeIdentity = this.resolveNativeSessionIdentity(payload.metadata)
    if (nativeIdentity) {
        const isDeleted = this.store.sessions.isNativeAliasDeleted(
            payload.namespace,
            nativeIdentity.provider,
            nativeIdentity.nativeSessionId
        )
        if (isDeleted) {
            return null
        }
    }
    // ... rest of existing logic
}
```

Note: the return type changes from `Session` to `Session | null`. Update callers in `cliNative.ts` to handle `null` (return 404 or 200 with `{ session: null }`).

- [ ] **Step 8: Update cliNative.ts to handle null upsert result**

In `hub/src/web/routes/cliNative.ts`, `POST /sessions/upsert`:
```typescript
const session = engine.upsertNativeSession({ ... })
if (!session) {
    return c.json({ session: null, skipped: true }, 200)
}
return c.json({ session })
```

- [ ] **Step 9: Run tests**

```bash
bun test hub/src/sync/syncEngine.test.ts
bun test hub/src/web/routes/cliNative.test.ts
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add hub/src/store/index.ts hub/src/store/sessions.ts hub/src/store/sessionStore.ts hub/src/sync/syncEngine.ts hub/src/web/routes/cliNative.ts
git commit -m "feat: blacklist deleted native session aliases to prevent re-import

Adds deleted_native_aliases table (schema v7). On session delete, native
aliases are recorded. upsertNativeSession skips blacklisted aliases.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

## Chunk 3: Task 1 — Native Sessions as Sub-Items in SessionList

### Task 3: Group native sessions under parent HAPI sessions

**Files:**
- Modify: `web/src/components/SessionList.tsx` — add parent/child grouping logic and `NativeSubItem` component
- Modify: `web/src/components/SessionList.test.tsx` — add tests for sub-item rendering

**Key insight:** A native session is a "child" of a HAPI session when:
- The HAPI session's `metadata.nativeSessionId` matches the native session's `id` (unlikely), OR
- The native session's `metadata.nativeSessionId` matches the HAPI session's `metadata.nativeSessionId` AND they share the same path/directory.

Actually the simpler rule: within the same directory group, a session with `source === 'native'` that has a `nativeSessionId` matching another session's `metadata.nativeSessionId` is a child. If no parent found, it stays as a top-level item.

- [ ] **Step 1: Write failing test**

In `web/src/components/SessionList.test.tsx`, add a test:

```typescript
it('renders native session as sub-item under parent HAPI session', () => {
    const hapiSession = makeSession({ id: 'hapi-1', source: 'hapi', nativeSessionId: 'native-abc' })
    const nativeSession = makeSession({ id: 'native-1', source: 'native', nativeSessionId: 'native-abc' })
    render(<SessionList sessions={[hapiSession, nativeSession]} ... />)
    // native-1 should be rendered inside hapi-1's sub-item area, not as a top-level item
    expect(screen.getByTestId('session-item-native-1')).toBeInTheDocument()
    expect(screen.getByTestId('session-subitem-container-hapi-1')).toContainElement(
        screen.getByTestId('session-item-native-1')
    )
})
```

Run: `bun test web/src/components/SessionList.test.tsx` — expect FAIL.

- [ ] **Step 2: Add grouping helper function**

In `SessionList.tsx`, add after existing helper functions:

```typescript
type SessionWithChildren = {
    session: SessionSummary
    nativeChildren: SessionSummary[]
}

function groupNativeChildren(sessions: SessionSummary[]): SessionWithChildren[] {
    // Build a map: nativeSessionId → sessions that "own" that native id
    const parentByNativeId = new Map<string, SessionSummary>()
    for (const s of sessions) {
        const nativeId = s.metadata?.nativeSessionId?.trim()
        if (nativeId && s.metadata?.source !== 'native') {
            parentByNativeId.set(nativeId, s)
        }
    }

    const childIds = new Set<string>()
    const childrenByParentId = new Map<string, SessionSummary[]>()

    for (const s of sessions) {
        const nativeId = s.metadata?.nativeSessionId?.trim()
        if (!nativeId || s.metadata?.source !== 'native') continue
        const parent = parentByNativeId.get(nativeId)
        if (!parent) continue
        childIds.add(s.id)
        const existing = childrenByParentId.get(parent.id) ?? []
        existing.push(s)
        childrenByParentId.set(parent.id, existing)
    }

    return sessions
        .filter(s => !childIds.has(s.id))
        .map(s => ({
            session: s,
            nativeChildren: childrenByParentId.get(s.id) ?? []
        }))
}
```

- [ ] **Step 3: Update SessionGroup type and groupSessionsByDirectory**

Change `SessionGroup.sessions` from `SessionSummary[]` to `SessionWithChildren[]`:

```typescript
type SessionGroup = {
    directory: string
    displayName: string
    sessions: SessionWithChildren[]
    totalSessions: number
    hasActiveSession: boolean
}
```

In `groupSessionsByDirectory`, after sorting sessions, apply `groupNativeChildren`:

```typescript
const sortedSessions = [...groupSessions].sort(sortSessionsInGroup)
const withChildren = groupNativeChildren(sortedSessions.slice(0, MAX_SESSIONS_PER_DIRECTORY))
```

Update `totalSessions` to count only top-level (non-child) sessions.

- [ ] **Step 4: Add NativeSubItem component**

Add a simpler version of `SessionItem` for native children:

```tsx
function NativeSubItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
    groupDirectory: string
    api: ApiClient | null
    selected?: boolean
}) {
    const { session: s, onSelect, selected = false } = props
    const { t } = useTranslation()
    const sessionName = getSessionTitle(s)
    const nativeSessionId = s.metadata?.nativeSessionId?.trim() || null
    const nativeProvider = s.metadata?.nativeProvider?.trim() || getAgentLabel(s)
    const sessionTimes = formatSessionTimes(s, t)

    return (
        <button
            type="button"
            data-testid={`session-item-${s.id}`}
            onClick={() => onSelect(s.id)}
            className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] ${selected ? 'border-[var(--app-link)] bg-[var(--app-secondary-bg)]' : 'border-[var(--app-divider)] bg-[var(--app-bg)] hover:bg-[var(--app-secondary-bg)]'}`}
        >
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-[var(--app-hint)] text-xs shrink-0">↳</span>
                <span className="truncate font-medium text-xs">{sessionName}</span>
                {s.active && (
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.thinking ? 'bg-[#007AFF] animate-pulse' : 'bg-[var(--app-badge-success-text)]'}`} />
                )}
            </div>
            {nativeSessionId ? (
                <div className="pl-4 text-[10px] font-mono text-[var(--app-hint)] truncate">
                    <span className="font-semibold text-[var(--app-fg)] mr-1">{nativeProvider}</span>
                    {nativeSessionId}
                </div>
            ) : null}
            {sessionTimes ? (
                <div className="pl-4 text-[10px] text-[var(--app-hint)]">{sessionTimes}</div>
            ) : null}
        </button>
    )
}
```

- [ ] **Step 5: Update SessionItem to accept and render nativeChildren**

Add `nativeChildren` prop to `SessionItem`:

```typescript
function SessionItem(props: {
    session: SessionSummary
    nativeChildren: SessionSummary[]
    onSelect: (sessionId: string) => void
    groupDirectory: string
    api: ApiClient | null
    selected?: boolean
    selectedSessionId?: string | null
}) {
```

At the end of the `<button>` element (before closing `</button>`), add nothing — native children go *outside* the button, in a wrapper div. Restructure `SessionItem` to return a fragment:

```tsx
return (
    <>
        <button ...>
            {/* existing content */}
        </button>
        {props.nativeChildren.length > 0 && (
            <div
                data-testid={`session-subitem-container-${s.id}`}
                className="ml-4 flex flex-col gap-1 border-l border-dashed border-[var(--app-divider)] pl-3"
            >
                {props.nativeChildren.map(child => (
                    <NativeSubItem
                        key={child.id}
                        session={child}
                        onSelect={props.onSelect}
                        groupDirectory={props.groupDirectory}
                        api={props.api}
                        selected={child.id === props.selectedSessionId}
                    />
                ))}
            </div>
        )}
        {/* existing dialogs */}
    </>
)
```

- [ ] **Step 6: Update render loop in SessionList**

Change the `group.sessions.map` call to pass `nativeChildren` and `selectedSessionId`:

```tsx
{group.sessions.map((item) => (
    <SessionItem
        key={item.session.id}
        session={item.session}
        nativeChildren={item.nativeChildren}
        onSelect={props.onSelect}
        groupDirectory={group.directory}
        api={api}
        selected={item.session.id === selectedSessionId}
        selectedSessionId={selectedSessionId}
    />
))}
```

- [ ] **Step 7: Fix getSessionListContentAnimationKey**

Update to include children in the snapshot:

```typescript
function getSessionListContentAnimationKey(agentTab: SessionAgentTab, groups: SessionGroup[]): string {
    const snapshot = groups
        .map((group) =>
            `${group.directory}:${group.sessions.map((item) =>
                `${item.session.id}[${item.nativeChildren.map(c => c.id).join('+')}]`
            ).join(',')}`
        )
        .join('|')
    return `${agentTab}:${snapshot}`
}
```

- [ ] **Step 8: Fix visibleSessionCount**

```typescript
const visibleSessionCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.sessions.length, 0),
    [groups]
)
```

This already counts only top-level items (children are excluded from `sessions` array). No change needed.

- [ ] **Step 9: Run tests**

```bash
bun test web/src/components/SessionList.test.tsx
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add web/src/components/SessionList.tsx web/src/components/SessionList.test.tsx
git commit -m "feat: render native sessions as sub-items under parent HAPI session

Native sessions sharing the same nativeSessionId as a HAPI session are
now shown as indented children in the session list.

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

## Notes

- **Task 2 (reasoning)** is the simplest — 1 file, remove ~4 lines.
- **Task 3 (blacklist)** requires a schema migration. Test with an in-memory DB to avoid touching real data.
- **Task 1 (sub-items)** is purely frontend. The matching key is `nativeSessionId` — both parent and child carry the same value in `metadata.nativeSessionId`.
- Recommended execution order: Task 2 → Task 3 → Task 1 (simplest to most complex).
