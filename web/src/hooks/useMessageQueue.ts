import { useCallback, useEffect, useRef, useState } from 'react'
import type { AttachmentMetadata } from '@/types/api'
import { makeClientSideId } from '@/lib/messages'

export type QueuedMessage = {
    id: string
    text: string
    attachments?: AttachmentMetadata[]
    createdAt: number
}

export type MessageQueueDeps = {
    sendMessage: (text: string, attachments?: AttachmentMetadata[]) => Promise<void>
    abort: () => void
    waitForIdle: () => Promise<void>
    onQueueFull?: () => void
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
    const queueRef = useRef(queue)
    const threadIsRunningRef = useRef(threadIsRunning)
    threadIsRunningRef.current = threadIsRunning

    // Keep ref in sync
    useEffect(() => {
        queueRef.current = queue
    }, [queue])

    useEffect(() => {
        if (sessionId) {
            const loaded = loadQueue(sessionId)
            setQueue(loaded)
            queueRef.current = loaded
        } else {
            setQueue([])
            queueRef.current = []
        }
    }, [sessionId])

    const persist = useCallback((next: QueuedMessage[]) => {
        if (sessionId) saveQueue(sessionId, next)
    }, [sessionId])

    const setQueueAndRef = useCallback((next: QueuedMessage[]) => {
        queueRef.current = next
        setQueue(next)
    }, [])

    const enqueue = useCallback((text: string, attachments?: AttachmentMetadata[]) => {
        if (!sessionId) return
        const prev = queueRef.current
        if (prev.length >= MAX_QUEUE_SIZE) {
            deps.onQueueFull?.()
            return
        }
        const item: QueuedMessage = {
            id: makeClientSideId('queue'),
            text,
            attachments,
            createdAt: Date.now(),
        }
        const next = [...prev, item]
        persist(next)
        setQueueAndRef(next)
    }, [sessionId, persist, deps, setQueueAndRef])

    const remove = useCallback((id: string) => {
        const next = queueRef.current.filter((m) => m.id !== id)
        persist(next)
        setQueueAndRef(next)
    }, [persist, setQueueAndRef])

    const update = useCallback((id: string, text: string, attachments?: AttachmentMetadata[]) => {
        const next = queueRef.current.map((m) =>
            m.id === id ? { ...m, text, ...(attachments !== undefined ? { attachments } : {}) } : m
        )
        persist(next)
        setQueueAndRef(next)
    }, [persist, setQueueAndRef])

    const editInComposer = useCallback((id: string): QueuedMessage | null => {
        const prev = queueRef.current
        const idx = prev.findIndex((m) => m.id === id)
        if (idx === -1) return null
        const found = prev[idx]
        const next = prev.filter((_, i) => i !== idx)
        persist(next)
        setQueueAndRef(next)
        return found
    }, [persist, setQueueAndRef])

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
            const snapshot = [...queueRef.current]
            persist([])
            setQueueAndRef([])

            for (let i = 0; i < snapshot.length; i++) {
                try {
                    await deps.sendMessage(snapshot[i].text, snapshot[i].attachments)
                } catch {
                    // Restore failed + remaining
                    const remaining = snapshot.slice(i)
                    setQueueAndRef(remaining)
                    persist(remaining)
                    break
                }
            }
        } finally {
            flushingRef.current = false
            setIsFlushing(false)
        }
    }, [sessionId, deps, persist, setQueueAndRef])

    const clear = useCallback(() => {
        setQueueAndRef([])
        if (sessionId) saveQueue(sessionId, [])
    }, [sessionId, setQueueAndRef])

    return { queue, isFlushing, enqueue, remove, update, editInComposer, flush, clear }
}
