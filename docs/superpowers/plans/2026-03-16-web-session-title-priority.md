# Web Session Title Priority Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 Web / 通知 / 语音的会话标题优先级，并让首条真实用户消息成为 MCP 标题缺失时的 fallback。

**Architecture:** 在 shared 提供统一标题 helper；自动标题统一落到 `metadata.summary`，其中 MCP 标记为 `generated`、首条用户消息标记为 `first-message`。Hub 在消息入口补 fallback，Web/通知/语音只消费统一 helper。

**Tech Stack:** TypeScript, Bun, Vitest, shared protocol types.

---

## Chunk 1: shared 标题 helper 与 schema

### Task 1: 增加统一标题解析能力

**Files:**
- Modify: `shared/src/schemas.ts`
- Create: `shared/src/sessionTitle.ts`
- Modify: `shared/src/index.ts`

- [ ] 增加 `metadata.summary.source?: 'generated' | 'first-message'`
- [ ] 实现标题提取/截断/解析 helper
- [ ] 导出 helper

## Chunk 2: 写入自动标题

### Task 2: MCP 与 native 写入统一 summary

**Files:**
- Modify: `cli/src/api/apiSession.ts`
- Modify: `cli/src/nativeSync/NativeSyncService.ts`

- [ ] MCP 生成标题写 `summary.source=generated`
- [ ] native provider title 写 `summary.source=first-message`，不再占用 `metadata.name`

### Task 3: Hub 在首条用户消息补 fallback

**Files:**
- Create: `hub/src/sync/sessionTitle.ts`
- Modify: `hub/src/sync/messageService.ts`
- Modify: `hub/src/socket/handlers/cli/sessionHandlers.ts`

- [ ] 从真实用户消息提取标题
- [ ] 仅在没有自动标题时写入 `summary.source=first-message`

## Chunk 3: 消费统一标题 helper

### Task 4: Web / 通知 / 语音统一读法

**Files:**
- Modify: `web/src/components/SessionHeader.tsx`
- Modify: `web/src/components/SessionList.tsx`
- Modify: `hub/src/notifications/sessionInfo.ts`
- Modify: `web/src/realtime/hooks/contextFormatters.ts`
- Modify: `web/src/types/api.ts`

- [ ] Web 标题统一 helper
- [ ] 通知标题统一 helper
- [ ] 语音上下文标题统一 helper

## Chunk 4: 测试

### Task 5: 覆盖优先级与 fallback

**Files:**
- Create/Modify tests as needed near changed files

- [ ] helper 测试：优先级、50 字符截断、首条消息提取
- [ ] Web 组件测试：generated 优先于 fallback
- [ ] CLI / hub focused tests 通过
