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
    clearComposer?: () => void
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
    const depsRef = useRef(deps)
    depsRef.current = deps
    const prevRunningRef = useRef(threadIsRunning)

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
            depsRef.current.onQueueFull?.()
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
    }, [sessionId, persist, setQueueAndRef])

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
        if (queueRef.current.length === 0) return
        flushingRef.current = true
        setIsFlushing(true)

        try {
            // Abort current run if thread is active
            if (prevRunningRef.current) {
                depsRef.current.abort()
                // Clear composer to prevent abort from refilling the input
                depsRef.current.clearComposer?.()
            }

            // Snapshot and clear
            const snapshot = [...queueRef.current]
            persist([])
            setQueueAndRef([])

            // Concatenate all messages into one
            const mergedText = snapshot.map(m => m.text).join('\n\n')
            const mergedAttachments = snapshot.flatMap(m => m.attachments ?? [])

            try {
                await depsRef.current.sendMessage(
                    mergedText,
                    mergedAttachments.length > 0 ? mergedAttachments : undefined,
                )
            } catch {
                // Restore all messages back to queue on failure
                setQueueAndRef(snapshot)
                persist(snapshot)
            }
        } finally {
            flushingRef.current = false
            setIsFlushing(false)
        }
    }, [sessionId, persist, setQueueAndRef])

    const clear = useCallback(() => {
        setQueueAndRef([])
        if (sessionId) saveQueue(sessionId, [])
    }, [sessionId, setQueueAndRef])

    // Auto-flush: when thread transitions from running → idle and queue is non-empty
    useEffect(() => {
        const wasRunning = prevRunningRef.current
        prevRunningRef.current = threadIsRunning
        if (wasRunning && !threadIsRunning && queueRef.current.length > 0) {
            void flush()
        }
    }, [threadIsRunning, flush])

    return { queue, isFlushing, enqueue, remove, update, editInComposer, flush, clear }
}
