# Message Queue - 多条消息合并发送

> 日期: 2026-03-18
> 状态: Draft

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
function useMessageQueue(sessionId: string | null): {
  queue: QueuedMessage[]
  enqueue: (text: string, attachments?: AttachmentMetadata[]) => void
  remove: (id: string) => void
  update: (id: string, text: string) => void
  flush: (sendFn: (text: string, attachments?: AttachmentMetadata[]) => void, abortFn?: () => void) => void
  clear: () => void
}
```

### 行为说明

- `enqueue`: 创建 QueuedMessage 并追加到队列尾部，同步写入 localStorage
- `remove`: 从队列中移除指定消息（撤回）
- `update`: 修改指定消息的文本内容（更改）
- `flush`: 按顺序逐条调用 sendFn 发送所有排队消息，发送前若需要可先调用 abortFn 中止当前 Agent
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
1. 若 threadIsRunning → 调用 abortFn() 中止 Agent
2. 等待 threadIsRunning 变为 false
3. 按队列顺序逐条调用 sendFn(text, attachments)
4. 每条发送间隔极短（依赖 sendMessage 的串行机制）
5. 清空队列 + localStorage
```

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
- 点击气泡 → 进入编辑模式（文本填回输入框，原消息从队列移除）
- 点击 ✕ → 从队列移除（撤回）
- 横向滚动，支持多条消息

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
| `web/src/hooks/mutations/useSendMessage.ts` | 微调 | 移除 pending 阻塞，暴露单条发送能力 |

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
3. **flush 期间某条发送失败**: 已发送的不回滚，失败的保留在 message-window-store 中显示重试按钮
4. **快速连续 flush**: flush 内部加锁，防止重复发送
5. **编辑中切换 session**: 队列自动切换到新 session 的持久化数据
