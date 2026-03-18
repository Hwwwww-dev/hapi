# Message Queue - 多条消息合并发送

> 日期: 2026-03-18
> 状态: Approved

## 概述

在 Web 端 Composer 中新增消息队列功能，允许用户在 Agent 思考期间或主动选择时，将多条消息排入队列，支持撤回、修改、立即发送（中止后发送）。队列通过 localStorage 持久化，切换 session 不丢失。

## 动机

当前 `useSendMessage` 在 Agent 运行时会阻塞发送（`pending` 状态）。用户无法在等待期间准备后续消息。消息队列解决了这个痛点，同时提供了"多条消息合并发送"的能力。

## 数据结构

```typescript
type QueuedMessage = {
  id: string                      // makeClientSideId('queue') 生成
  text: string                    // 消息文本
  attachments?: AttachmentMetadata[]  // 可选附件
  createdAt: number               // 入队时间戳
}
```

localStorage key: `hapi_msg_queue::${sessionId}`
value: `JSON.stringify(QueuedMessage[])`

## 核心 Hook: `useMessageQueue`

```typescript
function useMessageQueue(sessionId: string | null, deps: {
  sendMessage: (text: string, attachments?: AttachmentMetadata[]) => Promise<void>
  abort: () => void
  waitForIdle: () => Promise<void>
}): {
  queue: QueuedMessage[]
  isFlushing: boolean
  enqueue: (text: string, attachments?: AttachmentMetadata[]) => void
  remove: (id: string) => void
  update: (id: string, text: string, attachments?: AttachmentMetadata[]) => void
  editInComposer: (id: string) => QueuedMessage | null  // 取出消息供编辑，同时从队列移除
  flush: () => Promise<void>
  clear: () => void
}
```

队列上限：最多 20 条消息。

### 行为说明

- `enqueue`: 创建 QueuedMessage 并追加到队列尾部，同步写入 localStorage
- `remove`: 从队列中移除指定消息（撤回）
- `update`: 修改指定消息的文本和附件（更改）
- `editInComposer`: 从队列中取出消息（移除），返回其内容供填回 Composer 输入框和附件区域
- `flush`: 串行发送全部排队消息（见下方详细流程），内部加锁防止重复调用
- `clear`: 清空队列并清除 localStorage
- sessionId 变化时，从 localStorage 恢复对应队列

## 发送策略

| Agent 状态 | 队列状态 | Enter | Ctrl+Enter |
|:---|:---|:---|:---|
| 空闲 | 队列为空 | 直接发送（原行为） | 直接发送 |
| 空闲 | 队列非空 | 入队 | flush 全部发送 |
| 运行中 | 任意 | 入队 | abort → flush 全部发送 |

### flush 流程

```
1. 加锁（isFlushing = true），防止重复调用
2. 若 threadIsRunning → 调用 deps.abort() 中止 Agent
3. 调用 deps.waitForIdle()（内部通过订阅 threadIsRunning 状态变化实现，超时 10s 后放弃并抛错）
4. 快照当前队列，立即清空队列 + localStorage
5. 按快照顺序逐条 await deps.sendMessage(text, attachments)
   - 若某条发送失败：将该条及后续未发送消息重新放回队列并持久化，停止发送
6. 解锁（isFlushing = false）
```

### waitForIdle 实现方案

由 `useSendMessage` 新增暴露，基于 `threadIsRunning` 状态：

```typescript
function waitForIdle(timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!threadIsRunning) { resolve(); return }
    const timer = setTimeout(() => reject(new Error('Abort timeout')), timeout)
    // 订阅 threadIsRunning 变化，变为 false 时 resolve
    const unsubscribe = subscribeToRunningState(() => {
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })
}
```

### useSendMessage 改造

不移除 pending 阻塞（保留原有保护机制），而是新增一个 `sendQueued` 方法：

```typescript
// 新增：供队列 flush 使用，返回 Promise，不做 pending 阻塞检查
sendQueued: (text: string, attachments?: AttachmentMetadata[]) => Promise<void>
```

原有 `sendMessage` 和 `retryMessage` 行为完全不变。

## UI 设计

### 队列预览区域

位置：Composer 输入框上方（与附件区域同层），仅在队列非空时显示。

```
┌─────────────────────────────────────────┐
│ StatusBar                               │
├─────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌──────────┐   │  ← 队列预览
│ │ msg1  ✕ │ │ msg2  ✕ │ │ 发送全部 │   │
│ └─────────┘ └─────────┘ └──────────┘   │
├─────────────────────────────────────────┤
│ [输入框...]                             │
├─────────────────────────────────────────┤
│ [ComposerButtons]                       │
└─────────────────────────────────────────┘
```

### 队列消息气泡

- 显示消息文本预览（截断至 ~50 字符）
- 点击气泡 → 进入编辑模式（调用 `editInComposer`，文本填回输入框，附件恢复到 Composer 附件区域，原消息从队列移除）
- 点击 ✕ → 从队列移除（撤回）
- 横向滚动，支持多条消息

### 视觉提示

- 队列非空时，Composer 输入框 placeholder 变为"输入消息并按 Enter 加入队列（Ctrl+Enter 发送全部）"
- 发送按钮图标切换为"入队"样式（如 + 号），Ctrl+Enter 时切换为"发送全部"
- 队列预览区域左侧显示队列计数徽标

### 发送全部按钮

- 位于队列预览区域右侧
- 点击效果等同于 Ctrl+Enter（flush）
- Agent 运行中时显示为"中止并发送"

## 组件: `MessageQueuePreview`

```typescript
function MessageQueuePreview(props: {
  queue: QueuedMessage[]
  onRemove: (id: string) => void
  onEdit: (item: QueuedMessage) => void
  onFlush: () => void
  isRunning: boolean
}): JSX.Element | null
```

- 队列为空时返回 null
- 使用项目现有的 CSS 变量（`--app-secondary-bg`, `--app-hint` 等）
- 气泡样式与附件区域保持一致

## 文件变更清单

| 文件 | 操作 | 说明 |
|:---|:---|:---|
| `web/src/hooks/useMessageQueue.ts` | 新增 | 队列状态管理 + localStorage 持久化 |
| `web/src/components/AssistantChat/MessageQueuePreview.tsx` | 新增 | 队列预览 UI |
| `web/src/components/AssistantChat/HappyComposer.tsx` | 修改 | 集成队列 + 键盘快捷键 |
| `web/src/hooks/mutations/useSendMessage.ts` | 修改 | 新增 `sendQueued` (返回 Promise) + `waitForIdle` |

## localStorage 持久化

采用项目现有的 try-catch 安全模式：

```typescript
const QUEUE_KEY_PREFIX = 'hapi_msg_queue::'

function loadQueue(sessionId: string): QueuedMessage[] {
  try {
    const stored = localStorage.getItem(`${QUEUE_KEY_PREFIX}${sessionId}`)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveQueue(sessionId: string, queue: QueuedMessage[]): void {
  try {
    if (queue.length === 0) {
      localStorage.removeItem(`${QUEUE_KEY_PREFIX}${sessionId}`)
    } else {
      localStorage.setItem(`${QUEUE_KEY_PREFIX}${sessionId}`, JSON.stringify(queue))
    }
  } catch {
    // Ignore storage errors
  }
}
```

## 边界情况

1. **sessionId 为 null**: hook 返回空队列，所有操作为 no-op
2. **localStorage 满**: saveQueue 静默失败，队列仍在内存中可用
3. **flush 期间某条发送失败**: 停止后续发送，将失败消息及剩余消息放回队列，用户可重试或编辑
4. **快速连续 flush**: flush 内部加锁（isFlushing），防止重复发送
5. **编辑中切换 session**: 队列自动切换到新 session 的持久化数据
6. **abort 超时**: waitForIdle 超时 10s 后抛错，flush 捕获后将消息放回队列
7. **队列上限**: 超过 20 条时 enqueue 静默拒绝并给出 toast 提示
