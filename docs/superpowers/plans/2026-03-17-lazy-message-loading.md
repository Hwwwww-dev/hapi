# Lazy Message Loading Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打开 session 只加载最新 N 条消息，向上滚动时才通过 API 请求更旧的数据，而非一次性全量加载到内存。

**Architecture:** 后端存储层改为真正的数据库分页（不再全量加载到内存再切片）；前端 `loadCanonicalSnapshot` 改为只加载最新一页；`fetchOlderMessages` 改为向后端请求更旧的数据页，追加到 `roots` 头部。

**Tech Stack:** TypeScript, SQLite (better-sqlite3), React, Zustand-like store

---

## Chunk 1: 后端存储层真正分页

### Task 1: 修复后端 `getCanonicalRootsPage` — 真正的数据库分页

**问题根因：** `hub/src/store/canonicalBlocks.ts` 中 `getCanonicalRootsPage` 先用 `listCanonicalBlocksByGeneration` 加载该 session **所有** blocks 到内存，再做数组切片。消息量大时每次请求都要全量读取。

**修复方案：** 改为直接在 SQL 层做分页，利用 `timeline_seq` 做游标查询。

**Files:**
- Modify: `hub/src/store/canonicalBlocks.ts`
- Test: `hub/src/store/canonicalBlockStore.test.ts`

- [ ] **Step 1: 写失败测试 — 验证分页不加载全量数据**

在 `hub/src/store/canonicalBlockStore.test.ts` 中添加：

```typescript
it('getRootsPage with beforeTimelineSeq only queries needed rows', () => {
    // 插入 200 条 root blocks
    for (let i = 1; i <= 200; i++) {
        insertCanonicalBlock(db, makeRootBlock({ sessionId: 'sess-1', timelineSeq: i, generation: 1 }))
    }

    // 请求第 2 页（beforeTimelineSeq=51, limit=50）
    const page = getCanonicalRootsPage(db, 'sess-1', {
        generation: 1,
        beforeTimelineSeq: 51,
        limit: 50
    })

    expect(page.items).toHaveLength(50)
    expect(page.items[0].timelineSeq).toBe(51)
    expect(page.items[49].timelineSeq).toBe(100)
    expect(page.page.hasMore).toBe(true)
    expect(page.page.nextBeforeTimelineSeq).toBe(101)
})

it('getRootsPage with beforeTimelineSeq=null returns latest page', () => {
    for (let i = 1; i <= 200; i++) {
        insertCanonicalBlock(db, makeRootBlock({ sessionId: 'sess-2', timelineSeq: i, generation: 1 }))
    }

    const page = getCanonicalRootsPage(db, 'sess-2', {
        generation: 1,
        beforeTimelineSeq: null,
        limit: 50
    })

    // beforeTimelineSeq=null 应返回最新的 50 条（timelineSeq 151-200）
    expect(page.items).toHaveLength(50)
    expect(page.items[0].timelineSeq).toBe(151)
    expect(page.items[49].timelineSeq).toBe(200)
    expect(page.page.hasMore).toBe(true)
    expect(page.page.nextBeforeTimelineSeq).toBe(151) // 向前翻页的游标
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /home/hwwwww/Project/hapi
bun test hub/src/store/canonicalBlockStore.test.ts --run 2>&1 | tail -20
```

Expected: FAIL（当前实现返回从头开始的数据，不是最新的）

- [ ] **Step 3: 修改 `getCanonicalRootsPage` 实现**

在 `hub/src/store/canonicalBlocks.ts` 中，将 `getCanonicalRootsPage` 改为：

```typescript
export function getCanonicalRootsPage(
    db: Database,
    sessionId: string,
    options: GetCanonicalRootsPageOptions
): StoredCanonicalRootsPage {
    const generation = Math.trunc(options.generation)
    const limit = Number.isFinite(options.limit)
        ? Math.max(1, Math.trunc(options.limit))
        : 50
    const beforeTimelineSeq = options.beforeTimelineSeq === null
        ? null
        : Math.trunc(options.beforeTimelineSeq)

    // 查询 root blocks 总数（用于判断 hasMore）
    const totalCount = (db.prepare(`
        SELECT COUNT(*) as count FROM canonical_blocks
        WHERE session_id = ? AND generation = ? AND depth = 0
    `).get(sessionId, generation) as { count: number }).count

    // 分页查询：beforeTimelineSeq=null 时取最新 limit 条；否则取 >= beforeTimelineSeq 的 limit 条
    let rootRows: DbCanonicalBlockRow[]
    let pageStartSeq: number | null

    if (beforeTimelineSeq === null) {
        // 取最新 limit 条 root blocks
        rootRows = db.prepare(`
            SELECT * FROM canonical_blocks
            WHERE session_id = ? AND generation = ? AND depth = 0
            ORDER BY timeline_seq DESC
            LIMIT ?
        `).all(sessionId, generation, limit) as DbCanonicalBlockRow[]
        rootRows.reverse() // 恢复升序
        pageStartSeq = rootRows[0]?.timeline_seq ?? null
    } else {
        // 取 timeline_seq >= beforeTimelineSeq 的 limit 条
        rootRows = db.prepare(`
            SELECT * FROM canonical_blocks
            WHERE session_id = ? AND generation = ? AND depth = 0
              AND timeline_seq >= ?
            ORDER BY timeline_seq ASC
            LIMIT ?
        `).all(sessionId, generation, beforeTimelineSeq, limit) as DbCanonicalBlockRow[]
        pageStartSeq = beforeTimelineSeq
    }

    if (rootRows.length === 0) {
        return {
            items: [],
            page: { generation, limit, beforeTimelineSeq, nextBeforeTimelineSeq: null, hasMore: false }
        }
    }

    const rootIds = rootRows.map(r => r.id)
    const lastRootSeq = rootRows.at(-1)!.timeline_seq

    // 批量加载这些 root blocks 的所有子节点
    const placeholders = rootIds.map(() => '?').join(',')
    const childRows = db.prepare(`
        SELECT * FROM canonical_blocks
        WHERE session_id = ? AND generation = ? AND depth > 0
          AND root_block_id IN (${placeholders})
        ORDER BY timeline_seq ASC, depth ASC, sibling_seq ASC, id ASC
    `).all(sessionId, generation, ...rootIds) as DbCanonicalBlockRow[]

    const allRows = [...rootRows, ...childRows]
    const roots = buildCanonicalRoots(allRows.map(toStoredCanonicalBlock))

    // 判断是否还有更旧的数据（timeline_seq < pageStartSeq）
    const hasMoreOlder = pageStartSeq !== null && (db.prepare(`
        SELECT 1 FROM canonical_blocks
        WHERE session_id = ? AND generation = ? AND depth = 0
          AND timeline_seq < ?
        LIMIT 1
    `).get(sessionId, generation, pageStartSeq) !== undefined)

    // 判断是否还有更新的数据（timeline_seq > lastRootSeq）
    const hasMoreNewer = (db.prepare(`
        SELECT 1 FROM canonical_blocks
        WHERE session_id = ? AND generation = ? AND depth = 0
          AND timeline_seq > ?
        LIMIT 1
    `).get(sessionId, generation, lastRootSeq) !== undefined)

    // nextBeforeTimelineSeq: 向前翻页的游标（更旧的数据）
    const nextBeforeTimelineSeq = hasMoreOlder ? (pageStartSeq ?? null) : null

    return {
        items: roots,
        page: {
            generation,
            limit,
            beforeTimelineSeq,
            nextBeforeTimelineSeq,
            hasMore: hasMoreOlder
        }
    }
}
```

注意：需要在 `DbCanonicalBlockRow` 类型中确认 `timeline_seq` 字段名（snake_case）。

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test hub/src/store/canonicalBlockStore.test.ts --run 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 5: 运行全量测试确认无回归**

```bash
bun test hub/src --run 2>&1 | tail -30
```

- [ ] **Step 6: Commit**

```bash
git add hub/src/store/canonicalBlocks.ts hub/src/store/canonicalBlockStore.test.ts
git commit -m "fix(hub): true db-level pagination for canonical blocks page

Previously loaded all blocks into memory then sliced. Now queries
only the needed root blocks + their children directly from SQLite.

via HAPI <https://hapi.run>
Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

## Chunk 2: 前端改为真正懒加载

### Task 2: 修改 `message-window-store.ts` — 初始只加载最新一页，滚动时请求更旧数据

**问题根因：** `loadCanonicalSnapshot` 循环请求直到 `cursor === null`，把所有历史消息全部加载到内存。`fetchOlderMessages` 只是移动内存窗口，不发 API 请求。

**修复方案：**
1. `loadCanonicalSnapshot` 改为只加载最新一页（`beforeTimelineSeq: null, limit: PAGE_SIZE`）
2. `fetchOlderMessages` 改为向 API 请求更旧的数据，追加到 `roots` 头部
3. store state 增加 `oldestLoadedSeq` 游标，用于下次请求

**Files:**
- Modify: `web/src/lib/message-window-store.ts`
- Test: `web/src/lib/message-window-store.test.ts`

- [ ] **Step 1: 写失败测试 — 初始加载只请求一次 API**

在 `web/src/lib/message-window-store.test.ts` 中添加：

```typescript
it('fetchLatestMessages only makes one API call on initial load', async () => {
    const callLog: string[] = []
    const mockApi = {
        getMessages: vi.fn().mockImplementation(async (sessionId, opts) => {
            callLog.push(`beforeSeq=${opts.beforeTimelineSeq ?? 'null'}`)
            return {
                items: makeMockRoots(50, opts.beforeTimelineSeq ?? 200),
                page: {
                    generation: 1,
                    parserVersion: 1,
                    latestStreamSeq: 50,
                    limit: 50,
                    beforeTimelineSeq: opts.beforeTimelineSeq ?? null,
                    nextBeforeTimelineSeq: 151, // 还有更旧的数据
                    hasMore: true
                }
            }
        })
    }

    await fetchLatestMessages(mockApi as any, 'sess-1')

    // 只应该调用一次 API（不循环加载全量）
    expect(mockApi.getMessages).toHaveBeenCalledTimes(1)
    expect(callLog).toEqual(['beforeSeq=null'])

    const state = getState('sess-1')
    expect(state.hasMore).toBe(true) // 还有更旧的数据可以加载
})

it('fetchOlderMessages makes API call to load older data', async () => {
    // 先设置初始状态（已加载最新 50 条，游标在 151）
    // ...
    const mockApi = {
        getMessages: vi.fn().mockResolvedValue({
            items: makeMockRoots(50, 100),
            page: {
                generation: 1, parserVersion: 1, latestStreamSeq: 50,
                limit: 50, beforeTimelineSeq: 151,
                nextBeforeTimelineSeq: 101, hasMore: true
            }
        })
    }

    await fetchOlderMessages(mockApi as any, 'sess-1')

    expect(mockApi.getMessages).toHaveBeenCalledWith('sess-1', {
        generation: 1,
        beforeTimelineSeq: 151, // 使用存储的游标
        limit: 50
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun test web/src/lib/message-window-store.test.ts --run 2>&1 | tail -20
```

- [ ] **Step 3: 修改 store state 类型，增加 `olderPageCursor`**

在 `web/src/lib/message-window-store.ts` 中，找到 state 类型定义，增加字段：

```typescript
// 在 MessageWindowState 类型中增加
olderPageCursor: number | null  // 向前翻页的游标（nextBeforeTimelineSeq from API）
```

- [ ] **Step 4: 修改 `loadCanonicalSnapshot` — 只加载最新一页**

将循环加载逻辑改为单次请求：

```typescript
async function loadCanonicalSnapshot(
    api: ApiClient,
    sessionId: string,
    generationHint: number | null,
    head: MessagesResponse
): Promise<{
    roots: CanonicalRootBlock[]
    generation: number
    latestStreamSeq: number
    olderPageCursor: number | null
}> {
    // 直接使用 head page，不再循环
    const generation = getPageGeneration(head, generationHint)
    const latestStreamSeq = getPageLatestStreamSeq(head)
    const roots = head.items ?? []
    const olderPageCursor = head.page?.nextBeforeTimelineSeq ?? null

    return { roots, generation, latestStreamSeq, olderPageCursor }
}
```

- [ ] **Step 5: 修改 `fetchLatestMessages` — 保存 `olderPageCursor` 到 state**

找到 `fetchLatestMessages` 中调用 `loadCanonicalSnapshot` 后更新 state 的地方，确保保存 `olderPageCursor`：

```typescript
// 在 updateState 时增加
olderPageCursor: snapshot.olderPageCursor
```

- [ ] **Step 6: 修改 `fetchOlderMessages` — 发 API 请求而非移动内存窗口**

```typescript
export async function fetchOlderMessages(api: ApiClient, sessionId: string): Promise<void> {
    const initial = getState(sessionId)
    if (initial.isLoadingMore || !initial.hasMore) {
        return
    }

    updateState(sessionId, (prev) => buildState(prev, { isLoadingMore: true }))

    try {
        const cursor = initial.olderPageCursor
        if (cursor === null) {
            updateState(sessionId, (prev) => buildState(prev, { isLoadingMore: false, hasMore: false }))
            return
        }

        const response = await api.getMessages(sessionId, {
            generation: initial.generation,
            beforeTimelineSeq: cursor,
            limit: PAGE_SIZE
        })

        const olderRoots = response.items ?? []
        const nextCursor = response.page?.nextBeforeTimelineSeq ?? null

        updateState(sessionId, (prev) => {
            // 将更旧的数据追加到 roots 头部
            const mergedRoots = [...olderRoots, ...prev.roots]
            const window = applyWindow(mergedRoots, 0, prev.canonicalItems.length)
            return buildState(prev, {
                roots: mergedRoots,
                canonicalItems: window.items,
                hiddenCanonicalCount: window.hiddenCanonicalCount,
                windowStartIndex: window.windowStartIndex,
                olderPageCursor: nextCursor,
                hasMore: nextCursor !== null,
                isLoadingMore: false,
            })
        })
    } catch (error) {
        updateState(sessionId, (prev) => buildState(prev, { isLoadingMore: false }))
        throw error
    }
}
```

- [ ] **Step 7: 运行测试确认通过**

```bash
bun test web/src/lib/message-window-store.test.ts --run 2>&1 | tail -20
```

- [ ] **Step 8: 运行全量前端测试**

```bash
bun test web/src --run 2>&1 | tail -30
```

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/message-window-store.ts web/src/lib/message-window-store.test.ts
git commit -m "feat(web): true lazy loading — initial load only fetches latest page

Previously loadCanonicalSnapshot looped until all history was loaded.
Now only loads the latest PAGE_SIZE messages; fetchOlderMessages
makes real API calls to load older data on scroll.

via HAPI <https://hapi.run>
Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

## Chunk 3: SSE 实时更新兼容性修复

### Task 3: 确保实时新消息追加到 `roots` 尾部不受影响

**背景：** 实时消息通过 SSE 推送，会调用 store 的 `appendOrReplaceCanonicalBlock`。改造后 `roots` 只是部分历史，需要确认实时追加逻辑仍然正确。

**Files:**
- Read: `web/src/hooks/useSSE.ts`
- Read: `web/src/lib/message-window-store.ts` (appendOrReplace 相关逻辑)
- Test: `web/src/lib/message-window-store.test.ts`

- [ ] **Step 1: 确认 SSE 追加逻辑**

读取 `web/src/hooks/useSSE.ts` 中处理 canonical block 的部分，确认它调用的是哪个 store 函数。

- [ ] **Step 2: 写测试 — 实时消息追加到已懒加载的 roots 尾部**

```typescript
it('real-time SSE blocks append correctly to partially-loaded roots', () => {
    // 模拟只加载了最新 50 条（timelineSeq 151-200）
    // 然后收到 SSE 推送 timelineSeq=201 的新 block
    // 验证它被追加到 roots 尾部，窗口正确更新
})
```

- [ ] **Step 3: 运行测试，如有问题修复**

```bash
bun test web/src/lib/message-window-store.test.ts --run 2>&1 | tail -20
```

- [ ] **Step 4: 手动验证**

启动 dev server，打开一个有大量历史消息的 session，确认：
1. 初始加载速度明显变快
2. 向上滚动时触发 API 请求加载更旧消息
3. 实时新消息仍然正常显示

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/message-window-store.test.ts
git commit -m "test(web): verify SSE real-time blocks work with lazy-loaded roots

via HAPI <https://hapi.run>
Co-Authored-By: HAPI <noreply@hapi.run>"
```

---

## 注意事项

### 后端分页语义变更

`beforeTimelineSeq=null` 的语义从"从头开始"变为"从最新开始"（返回最新 limit 条）。这是 breaking change，需要确认所有调用方都兼容：

- `loadHeadPage` — 已经用 `beforeTimelineSeq: null` 请求最新数据 ✅
- `loadCanonicalSnapshot` — 改造后只用 head page ✅
- `fetchOlderMessages` — 改造后用 `nextBeforeTimelineSeq` 游标 ✅

### `mergeCanonicalRoots` 函数

`fetchOlderMessages` 中将旧数据追加到头部时，需要确认 `mergeCanonicalRoots` 或直接数组拼接的去重逻辑正确（避免 SSE 实时数据和历史数据重叠时出现重复）。

### 子节点加载

后端分页查询中，子节点（depth > 0）通过 `root_block_id IN (...)` 批量加载。需要确认 `canonical_blocks` 表有 `root_block_id` 字段且有索引。
