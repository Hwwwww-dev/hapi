# Message Queue Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a message queue to the Web Composer that buffers messages for batch sending, with revoke/edit/flush support and localStorage persistence.

**Architecture:** A `useMessageQueue` hook manages queue state + localStorage persistence. A `MessageQueuePreview` component renders inline queue bubbles above the input. `useSendMessage` gains a `sendQueued` method (returns Promise) and `waitForIdle` helper. `HappyComposer` integrates all pieces with updated keyboard shortcuts.

**Tech Stack:** React, TypeScript, Vitest, @assistant-ui/react, localStorage

**Spec:** `docs/superpowers/specs/2026-03-18-message-queue-design.md`

---

## File Structure

| File | Responsibility |
|:---|:---|
| `web/src/hooks/useMessageQueue.ts` | Queue state management + localStorage persistence |
| `web/src/hooks/useMessageQueue.test.ts` | Unit tests for queue hook |
| `web/src/components/AssistantChat/MessageQueuePreview.tsx` | Queue preview UI (bubbles + flush button) |
| `web/src/components/AssistantChat/MessageQueuePreview.test.tsx` | UI component tests |
| `web/src/hooks/mutations/useSendMessage.ts` | Add `sendQueued` + `waitForIdle` |
| `web/src/hooks/mutations/useSendMessage.test.ts` | Tests for new methods |
| `web/src/components/AssistantChat/HappyComposer.tsx` | Integrate queue into composer |

---

## Chunk 1: useMessageQueue Hook

### Task 1: useMessageQueue — Core Queue Logic

**Files:**
- Create: `web/src/hooks/useMessageQueue.ts`
- Create: `web/src/hooks/useMessageQueue.test.ts`

- [ ] **Step 1: Write failing tests for enqueue/remove/update/clear**

```typescript
// web/src/hooks/useMessageQueue.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessageQueue } from './useMessageQueue'

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value }),
        removeItem: vi.fn((key: string) => { delete store[key] }),
        clear: vi.fn(() => { store = {} }),
    }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

// Mock makeClientSideId
vi.mock('@/lib/messages', () => ({
    makeClientSideId: vi.fn((prefix: string) => `${prefix}-test-id-${Date.now()}`),
}))

const mockDeps = {
    sendMessage: vi.fn(async () => {}),
    abort: vi.fn(),
    waitForIdle: vi.fn(async () => {}),
}

describe('useMessageQueue', () => {
    beforeEach(() => {
        localStorageMock.clear()
        vi.clearAllMocks()
    })

    it('starts with empty queue', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        expect(result.current.queue).toEqual([])
        expect(result.current.isFlushing).toBe(false)
    })

    it('enqueues a message', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => { result.current.enqueue('hello') })
        expect(result.current.queue).toHaveLength(1)
        expect(result.current.queue[0].text).toBe('hello')
    })

    it('persists to localStorage on enqueue', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => { result.current.enqueue('hello') })
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            'hapi_msg_queue::session-1',
            expect.any(String)
        )
    })

    it('removes a message by id', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => { result.current.enqueue('msg1') })
        const id = result.current.queue[0].id
        act(() => { result.current.remove(id) })
        expect(result.current.queue).toHaveLength(0)
    })

    it('updates a message text', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => { result.current.enqueue('original') })
        const id = result.current.queue[0].id
        act(() => { result.current.update(id, 'updated') })
        expect(result.current.queue[0].text).toBe('updated')
    })

    it('clears all messages', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => {
            result.current.enqueue('a')
            result.current.enqueue('b')
        })
        act(() => { result.current.clear() })
        expect(result.current.queue).toHaveLength(0)
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('hapi_msg_queue::session-1')
    })

    it('enforces max 20 messages', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => {
            for (let i = 0; i < 25; i++) {
                result.current.enqueue(`msg-${i}`)
            }
        })
        expect(result.current.queue).toHaveLength(20)
    })

    it('restores queue from localStorage on sessionId change', () => {
        const stored = JSON.stringify([{ id: 'q-1', text: 'restored', createdAt: 1000 }])
        localStorageMock.getItem.mockReturnValueOnce(stored)
        const { result } = renderHook(() => useMessageQueue('session-2', mockDeps))
        expect(result.current.queue).toHaveLength(1)
        expect(result.current.queue[0].text).toBe('restored')
    })

    it('returns null queue when sessionId is null', () => {
        const { result } = renderHook(() => useMessageQueue(null, mockDeps))
        expect(result.current.queue).toEqual([])
        act(() => { result.current.enqueue('noop') })
        expect(result.current.queue).toEqual([])
    })

    it('editInComposer removes item and returns it', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => { result.current.enqueue('editable') })
        const id = result.current.queue[0].id
        let edited: ReturnType<typeof result.current.editInComposer>
        act(() => { edited = result.current.editInComposer(id) })
        expect(edited!).not.toBeNull()
        expect(edited!.text).toBe('editable')
        expect(result.current.queue).toHaveLength(0)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/hooks/useMessageQueue.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useMessageQueue hook**

```typescript
// web/src/hooks/useMessageQueue.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AttachmentMetadata } from '@/types/api'
import { makeClientSideId } from '@/lib/messages'

export type QueuedMessage = {
    id: string
    text: string
    attachments?: AttachmentMetadata[]
    createdAt: number
}

type MessageQueueDeps = {
    sendMessage: (text: string, attachments?: AttachmentMetadata[]) => Promise<void>
    abort: () => void
    waitForIdle: () => Promise<void>
}

const QUEUE_KEY_PREFIX = 'hapi_msg_queue::'
const MAX_QUEUE_SIZE = 20

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
    } catch { /* ignore */ }
}

export function useMessageQueue(
    sessionId: string | null,
    deps: MessageQueueDeps,
    threadIsRunning = false,
) {
    const [queue, setQueue] = useState<QueuedMessage[]>(() =>
        sessionId ? loadQueue(sessionId) : []
    )
    const [isFlushing, setIsFlushing] = useState(false)
    const flushingRef = useRef(false)
    const threadIsRunningRef = useRef(threadIsRunning)
    threadIsRunningRef.current = threadIsRunning

    useEffect(() => {
        setQueue(sessionId ? loadQueue(sessionId) : [])
    }, [sessionId])

    const persist = useCallback((next: QueuedMessage[]) => {
        if (sessionId) saveQueue(sessionId, next)
    }, [sessionId])

    const enqueue = useCallback((text: string, attachments?: AttachmentMetadata[]) => {
        if (!sessionId) return
        setQueue((prev) => {
            if (prev.length >= MAX_QUEUE_SIZE) return prev
            const item: QueuedMessage = {
                id: makeClientSideId('queue'),
                text,
                attachments,
                createdAt: Date.now(),
            }
            const next = [...prev, item]
            persist(next)
            return next
        })
    }, [sessionId, persist])

    const remove = useCallback((id: string) => {
        setQueue((prev) => {
            const next = prev.filter((m) => m.id !== id)
            persist(next)
            return next
        })
    }, [persist])

    const update = useCallback((id: string, text: string, attachments?: AttachmentMetadata[]) => {
        setQueue((prev) => {
            const next = prev.map((m) =>
                m.id === id ? { ...m, text, ...(attachments !== undefined ? { attachments } : {}) } : m
            )
            persist(next)
            return next
        })
    }, [persist])

    const editInComposer = useCallback((id: string): QueuedMessage | null => {
        let found: QueuedMessage | null = null
        setQueue((prev) => {
            const idx = prev.findIndex((m) => m.id === id)
            if (idx === -1) return prev
            found = prev[idx]
            const next = prev.filter((_, i) => i !== idx)
            persist(next)
            return next
        })
        return found
    }, [persist])

    const flush = useCallback(async () => {
        if (!sessionId || flushingRef.current) return
        flushingRef.current = true
        setIsFlushing(true)

        try {
            if (threadIsRunningRef.current) {
                deps.abort()
                await deps.waitForIdle()
            }

            // Snapshot and clear
            let snapshot: QueuedMessage[] = []
            setQueue((prev) => {
                snapshot = [...prev]
                persist([])
                return []
            })

            for (let i = 0; i < snapshot.length; i++) {
                try {
                    await deps.sendMessage(snapshot[i].text, snapshot[i].attachments)
                } catch {
                    // Restore failed + remaining
                    const remaining = snapshot.slice(i)
                    setQueue(remaining)
                    persist(remaining)
                    break
                }
            }
        } finally {
            flushingRef.current = false
            setIsFlushing(false)
        }
    }, [sessionId, deps, persist])

    const clear = useCallback(() => {
        setQueue([])
        if (sessionId) saveQueue(sessionId, [])
    }, [sessionId])

    return { queue, isFlushing, enqueue, remove, update, editInComposer, flush, clear }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/hooks/useMessageQueue.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useMessageQueue.ts web/src/hooks/useMessageQueue.test.ts
git commit -m "feat: add useMessageQueue hook with localStorage persistence"
```

### Task 2: useMessageQueue — Flush Logic

**Files:**
- Modify: `web/src/hooks/useMessageQueue.test.ts`
- Modify: `web/src/hooks/useMessageQueue.ts`

- [ ] **Step 1: Write failing tests for flush**

Append to `useMessageQueue.test.ts`:

```typescript
describe('flush', () => {
    it('calls sendMessage for each queued message in order', async () => {
        const calls: string[] = []
        const deps = {
            ...mockDeps,
            sendMessage: vi.fn(async (text: string) => { calls.push(text) }),
        }
        const { result } = renderHook(() => useMessageQueue('session-1', deps))
        act(() => {
            result.current.enqueue('first')
            result.current.enqueue('second')
        })
        await act(async () => { await result.current.flush() })
        expect(calls).toEqual(['first', 'second'])
        expect(result.current.queue).toHaveLength(0)
    })

    it('calls abort and waitForIdle when threadIsRunning', async () => {
        const deps = {
            ...mockDeps,
            abort: vi.fn(),
            waitForIdle: vi.fn(async () => {}),
        }
        const { result } = renderHook(() => useMessageQueue('session-1', deps, true))
        act(() => { result.current.enqueue('msg') })
        await act(async () => { await result.current.flush() })
        expect(deps.abort).toHaveBeenCalled()
        expect(deps.waitForIdle).toHaveBeenCalled()
    })

    it('stops sending on failure and restores remaining messages', async () => {
        let callCount = 0
        const deps = {
            ...mockDeps,
            sendMessage: vi.fn(async () => {
                callCount++
                if (callCount === 2) throw new Error('send failed')
            }),
        }
        const { result } = renderHook(() => useMessageQueue('session-1', deps))
        act(() => {
            result.current.enqueue('ok-1')
            result.current.enqueue('fail-2')
            result.current.enqueue('skip-3')
        })
        await act(async () => { await result.current.flush() })
        // fail-2 and skip-3 should be restored to queue
        expect(result.current.queue).toHaveLength(2)
        expect(result.current.queue[0].text).toBe('fail-2')
    })

    it('prevents concurrent flush calls', async () => {
        let resolveFirst: () => void
        const deps = {
            ...mockDeps,
            sendMessage: vi.fn(() => new Promise<void>((r) => { resolveFirst = r })),
        }
        const { result } = renderHook(() => useMessageQueue('session-1', deps))
        act(() => { result.current.enqueue('msg') })
        const p1 = act(async () => { await result.current.flush() })
        expect(result.current.isFlushing).toBe(true)
        // Second flush should be no-op
        await act(async () => { await result.current.flush() })
        resolveFirst!()
        await p1
    })
})
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd web && npx vitest run src/hooks/useMessageQueue.test.ts`
Expected: New flush tests FAIL

- [ ] **Step 3: Implement flush logic in useMessageQueue**

Add `threadIsRunning` as third parameter to hook. Implement flush with:
- Lock guard (`isFlushing` ref)
- If `threadIsRunning` → call `deps.abort()` then `await deps.waitForIdle()`
- Snapshot queue, clear queue + localStorage
- Sequential `await deps.sendMessage(msg.text, msg.attachments)` per item
- On failure: restore failed + remaining messages to queue

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/hooks/useMessageQueue.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useMessageQueue.ts web/src/hooks/useMessageQueue.test.ts
git commit -m "feat: add flush logic to useMessageQueue with error recovery"
```

## Chunk 2: useSendMessage Enhancement

### Task 3: Add sendQueued and waitForIdle to useSendMessage

**Files:**
- Modify: `web/src/hooks/mutations/useSendMessage.ts`

- [ ] **Step 1: Add `sendQueued` method**

Add a new method that:
- Accepts `(text: string, attachments?: AttachmentMetadata[]) => Promise<void>`
- Skips the `mutation.isPending` guard (queue handles serialization)
- Creates localId via `makeClientSideId('local')`
- Calls `appendOptimisticMessage` then `await api.sendMessage()`
- Updates status to 'sent' or 'failed'
- Handles `resolveSessionId` same as `sendMessage`

```typescript
const sendQueued = async (text: string, attachments?: AttachmentMetadata[]): Promise<void> => {
    if (!api) throw new Error('API unavailable')
    if (!sessionId) throw new Error('No session')

    const localId = makeClientSideId('local')
    const createdAt = Date.now()

    let targetSessionId = sessionId
    if (options?.resolveSessionId) {
        const resolved = await options.resolveSessionId(sessionId)
        if (resolved && resolved !== sessionId) {
            options.onSessionResolved?.(resolved)
            targetSessionId = resolved
        }
    }

    const optimisticMessage: DecryptedMessage = {
        id: localId,
        seq: null,
        localId,
        content: {
            role: 'user',
            content: { type: 'text', text, attachments }
        },
        createdAt,
        status: 'sending',
        originalText: text,
    }
    appendOptimisticMessage(targetSessionId, optimisticMessage)

    try {
        await api.sendMessage(targetSessionId, text, localId, attachments)
        updateMessageStatus(targetSessionId, localId, 'sent')
        haptic.notification('success')
    } catch (error) {
        updateMessageStatus(targetSessionId, localId, 'failed')
        haptic.notification('error')
        throw error
    }
}
```

- [ ] **Step 2: Add `waitForIdle` method**

```typescript
const waitForIdle = (timeout = 10000): Promise<void> => {
    return new Promise((resolve, reject) => {
        // Check immediately — threadIsRunning is captured via closure from the hook's render
        // We need to subscribe to the assistant state for real-time updates
        if (!mutation.isPending) { resolve(); return }
        const timer = setTimeout(() => reject(new Error('waitForIdle timeout')), timeout)
        const check = setInterval(() => {
            if (!mutation.isPending) {
                clearTimeout(timer)
                clearInterval(check)
                resolve()
            }
        }, 100)
    })
}
```

Note: The actual `threadIsRunning` check will be done in `HappyComposer` which has access to `useAssistantState`. The `waitForIdle` here checks mutation pending state. The composer-level integration will handle the thread-level idle check.

- [ ] **Step 3: Update return type**

```typescript
return {
    sendMessage,
    sendQueued,
    retryMessage,
    waitForIdle,
    isSending: mutation.isPending || isResolving,
}
```

- [ ] **Step 4: Run existing tests to verify no regression**

Run: `cd web && npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/mutations/useSendMessage.ts
git commit -m "feat: add sendQueued and waitForIdle to useSendMessage"
```

## Chunk 3: MessageQueuePreview Component

### Task 4: MessageQueuePreview UI

**Files:**
- Create: `web/src/components/AssistantChat/MessageQueuePreview.tsx`
- Create: `web/src/components/AssistantChat/MessageQueuePreview.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// MessageQueuePreview.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageQueuePreview } from './MessageQueuePreview'
import type { QueuedMessage } from '@/hooks/useMessageQueue'

const mockQueue: QueuedMessage[] = [
    { id: 'q-1', text: 'First message', createdAt: 1000 },
    { id: 'q-2', text: 'Second message with a very long text that should be truncated at fifty characters limit', createdAt: 2000 },
]

describe('MessageQueuePreview', () => {
    it('renders nothing when queue is empty', () => {
        const { container } = render(
            <MessageQueuePreview queue={[]} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={false} />
        )
        expect(container.firstChild).toBeNull()
    })

    it('renders queue items', () => {
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={false} />
        )
        expect(screen.getByText(/First message/)).toBeTruthy()
    })

    it('truncates long text', () => {
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={false} />
        )
        const longItem = screen.getByText(/Second message/)
        expect(longItem.textContent!.length).toBeLessThanOrEqual(53) // 50 + "..."
    })

    it('calls onRemove when clicking remove button', () => {
        const onRemove = vi.fn()
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={onRemove} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={false} />
        )
        const removeButtons = screen.getAllByRole('button', { name: /remove/i })
        fireEvent.click(removeButtons[0])
        expect(onRemove).toHaveBeenCalledWith('q-1')
    })

    it('calls onEdit when clicking a bubble', () => {
        const onEdit = vi.fn()
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={onEdit} onFlush={vi.fn()} isRunning={false} />
        )
        fireEvent.click(screen.getByText(/First message/))
        expect(onEdit).toHaveBeenCalled()
    })

    it('shows "发送全部" button when idle', () => {
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={false} />
        )
        expect(screen.getByText(/发送全部/)).toBeTruthy()
    })

    it('shows "中止并发送" button when running', () => {
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={true} />
        )
        expect(screen.getByText(/中止并发送/)).toBeTruthy()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/AssistantChat/MessageQueuePreview.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MessageQueuePreview**

```tsx
// web/src/components/AssistantChat/MessageQueuePreview.tsx
import type { QueuedMessage } from '@/hooks/useMessageQueue'
import { useTranslation } from '@/lib/use-translation'

function truncate(text: string, max = 50): string {
    return text.length > max ? text.slice(0, max) + '...' : text
}

export function MessageQueuePreview(props: {
    queue: QueuedMessage[]
    onRemove: (id: string) => void
    onEdit: (item: QueuedMessage) => void
    onFlush: () => void
    isRunning: boolean
}) {
    const { queue, onRemove, onEdit, onFlush, isRunning } = props
    const { t } = useTranslation()

    if (queue.length === 0) return null

    return (
        <div className="flex items-center gap-2 overflow-x-auto px-4 pt-3 pb-1">
            <div className="flex items-center gap-1.5 overflow-x-auto">
                {queue.map((item) => (
                    <div
                        key={item.id}
                        className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--app-bg)] px-3 py-1 text-xs text-[var(--app-fg)]"
                    >
                        <button
                            type="button"
                            className="max-w-[200px] truncate hover:underline cursor-pointer"
                            onClick={() => onEdit(item)}
                        >
                            {truncate(item.text)}
                        </button>
                        <button
                            type="button"
                            aria-label="remove"
                            className="ml-0.5 text-[var(--app-hint)] hover:text-[var(--app-fg)] cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation()
                                onRemove(item.id)
                            }}
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>
            <button
                type="button"
                className="shrink-0 rounded-full bg-[var(--app-link)] px-3 py-1 text-xs text-white hover:opacity-90 cursor-pointer"
                onClick={onFlush}
            >
                {isRunning ? t('misc.abortAndSend') : t('misc.sendAll')}
            </button>
        </div>
    )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/AssistantChat/MessageQueuePreview.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/AssistantChat/MessageQueuePreview.tsx web/src/components/AssistantChat/MessageQueuePreview.test.tsx
git commit -m "feat: add MessageQueuePreview component"
```

## Chunk 4: HappyComposer Integration

### Task 5: Integrate Queue into HappyComposer

**Files:**
- Modify: `web/src/components/AssistantChat/HappyComposer.tsx`

- [ ] **Step 1: Import and initialize useMessageQueue**

At the top of `HappyComposer`, after existing hooks:

```typescript
import { useMessageQueue } from '@/hooks/useMessageQueue'
import { MessageQueuePreview } from './MessageQueuePreview'
```

Inside the component, after `useSendMessage` is available (from parent via props or context):

```typescript
// Props need to receive sendQueued and waitForIdle from parent
// Add new props:
//   sendQueued: (text: string, attachments?: AttachmentMetadata[]) => Promise<void>
//   waitForIdle: () => Promise<void>

const messageQueue = useMessageQueue(sessionId, {
    sendMessage: props.sendQueued,
    abort: handleAbort,
    waitForIdle: props.waitForIdle,
}, threadIsRunning)
```

- [ ] **Step 2: Modify keyboard handling**

In `handleKeyDown`, update Enter behavior:

```typescript
// After suggestion handling, before existing Enter logic:
if (key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
    // Ctrl+Enter → flush (enqueue current + send all)
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        if (hasText) {
            messageQueue.enqueue(trimmed, attachments.length > 0 ? /* extract metadata */ undefined : undefined)
            api.composer().setText('')
        }
        void messageQueue.flush()
        return
    }

    // Enter with queue non-empty OR threadIsRunning → enqueue
    if (messageQueue.queue.length > 0 || threadIsRunning) {
        if (hasText) {
            e.preventDefault()
            messageQueue.enqueue(trimmed)
            api.composer().setText('')
        }
        return
    }
    // Otherwise: fall through to default send behavior
}
```

- [ ] **Step 3: Add queue edit handler**

```typescript
const handleQueueEdit = useCallback((item: QueuedMessage) => {
    api.composer().setText(item.text)
    messageQueue.remove(item.id)
    textareaRef.current?.focus()
}, [api, messageQueue])

const handleQueueFlush = useCallback(() => {
    if (hasText) {
        messageQueue.enqueue(trimmed)
        api.composer().setText('')
    }
    void messageQueue.flush()
}, [messageQueue, hasText, trimmed, api])
```

- [ ] **Step 4: Add MessageQueuePreview to JSX**

Inside the `<div className="overflow-hidden rounded-[20px] ...">`, before the attachments section:

```tsx
<MessageQueuePreview
    queue={messageQueue.queue}
    onRemove={messageQueue.remove}
    onEdit={handleQueueEdit}
    onFlush={handleQueueFlush}
    isRunning={threadIsRunning}
/>
```

- [ ] **Step 5: Update placeholder text**

```typescript
const queuePlaceholder = messageQueue.queue.length > 0
    ? t('misc.typeMessageQueue')  // "输入消息，Enter 入队 / Ctrl+Enter 发送全部"
    : showContinueHint ? t('misc.typeMessage') : t('misc.typeAMessage')
```

Use `queuePlaceholder` in the `ComposerPrimitive.Input` placeholder prop.

- [ ] **Step 6: Run all tests**

Run: `cd web && npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/components/AssistantChat/HappyComposer.tsx
git commit -m "feat: integrate message queue into HappyComposer"
```

### Task 6: Wire up sendQueued/waitForIdle from Router

**Files:**
- Modify: `web/src/router.tsx` (or wherever `useSendMessage` is called and passed to `HappyComposer`)

- [ ] **Step 1: Pass new props from useSendMessage to HappyComposer**

Where `useSendMessage` is called, destructure the new methods:

```typescript
const { sendMessage, sendQueued, retryMessage, waitForIdle, isSending } = useSendMessage(api, sessionId, { ... })
```

Pass `sendQueued` and `waitForIdle` as props to `HappyComposer`.

- [ ] **Step 2: Add translation key for queue placeholder**

Add `misc.typeMessageQueue` to the translation files with value: `"输入消息，Enter 入队 / Ctrl+Enter 发送全部"`

- [ ] **Step 3: Run full test suite**

Run: `cd web && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/router.tsx
git commit -m "feat: wire message queue props through router"
```

### Task 7: Manual Smoke Test

- [ ] **Step 1: Start dev server and verify**

Instruct user to run `cd web && npm run dev` and test:
1. Type message + Enter → direct send (queue empty, idle)
2. While agent is running, type + Enter → message enters queue
3. Queue bubbles appear above input
4. Click bubble → text fills back into input
5. Click ✕ → message removed from queue
6. Ctrl+Enter → all queued messages sent
7. Switch session → queue persists per session
8. Refresh page → queue restored from localStorage

- [ ] **Step 2: Final commit if any fixes needed**
