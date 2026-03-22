import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, forwardRef } from 'react'
import type { ApiClient } from '@/api/client'
import type { SessionMetadataSummary } from '@/types/api'
import { useChatContext } from '@/chat/chat-context'
import { renderBlock } from '@/chat/render-block'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

function MessageSkeleton() {
    const { t } = useTranslation()
    const rows = [
        { align: 'end', width: 'w-2/3', height: 'h-10' },
        { align: 'start', width: 'w-3/4', height: 'h-12' },
        { align: 'end', width: 'w-1/2', height: 'h-9' },
        { align: 'start', width: 'w-5/6', height: 'h-14' }
    ]

    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">{t('misc.loadingMessages')}</span>
            <div className="space-y-3 animate-pulse">
                {rows.map((row, index) => (
                    <div key={`skeleton-${index}`} className={row.align === 'end' ? 'flex justify-end' : 'flex justify-start'}>
                        <div className={`${row.height} ${row.width} rounded-xl bg-[var(--app-subtle-bg)]`} />
                    </div>
                ))}
            </div>
        </div>
    )
}

export interface HappyThreadHandle {
    scrollToBottom: () => void
}

export const HappyThread = forwardRef<HappyThreadHandle, {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onRefresh: () => void
    onRetryMessage?: (localId: string) => void
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    isLoadingMessages: boolean
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMoreMessages: boolean
    onLoadMore: () => Promise<unknown>
    pendingCount: number
    rawMessagesCount: number
    normalizedMessagesCount: number
    messagesVersion: number
    forceScrollToken: number
}>(function HappyThread(props, ref) {
    const { t } = useTranslation()
    const { blocks, isRunning } = useChatContext()
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const topSentinelRef = useRef<HTMLDivElement | null>(null)
    const loadLockRef = useRef(false)
    const pendingScrollRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
    const prevLoadingMoreRef = useRef(false)
    const loadStartedRef = useRef(false)
    const isLoadingMoreRef = useRef(props.isLoadingMoreMessages)
    const hasMoreMessagesRef = useRef(props.hasMoreMessages)
    const isLoadingMessagesRef = useRef(props.isLoadingMessages)
    const onLoadMoreRef = useRef(props.onLoadMore)
    const handleLoadMoreRef = useRef<() => void>(() => {})
    const atBottomRef = useRef(true)
    const scrollingToBottomRef = useRef(false)
    const onAtBottomChangeRef = useRef(props.onAtBottomChange)
    const onFlushPendingRef = useRef(props.onFlushPending)
    const forceScrollTokenRef = useRef(props.forceScrollToken)

    // Smart scroll state: autoScroll enabled when user is near bottom
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
    const autoScrollEnabledRef = useRef(autoScrollEnabled)

    // Keep refs in sync with state
    useEffect(() => {
        autoScrollEnabledRef.current = autoScrollEnabled
    }, [autoScrollEnabled])
    useEffect(() => {
        onAtBottomChangeRef.current = props.onAtBottomChange
    }, [props.onAtBottomChange])
    useEffect(() => {
        onFlushPendingRef.current = props.onFlushPending
    }, [props.onFlushPending])
    useEffect(() => {
        hasMoreMessagesRef.current = props.hasMoreMessages
    }, [props.hasMoreMessages])
    useEffect(() => {
        isLoadingMessagesRef.current = props.isLoadingMessages
    }, [props.isLoadingMessages])
    useEffect(() => {
        onLoadMoreRef.current = props.onLoadMore
    }, [props.onLoadMore])

    // Track scroll position to toggle autoScroll (throttled for performance)
    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        const THRESHOLD_PX = 120
        let rafId: number | null = null

        const handleScroll = () => {
            if (rafId !== null) return
            rafId = requestAnimationFrame(() => {
                rafId = null
                const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
                const isNearBottom = distanceFromBottom < THRESHOLD_PX

                if (isNearBottom) {
                    scrollingToBottomRef.current = false // Clear guard once we've arrived
                    if (!autoScrollEnabledRef.current) setAutoScrollEnabled(true)
                } else if (autoScrollEnabledRef.current && !scrollingToBottomRef.current) {
                    setAutoScrollEnabled(false)
                }

                // Suppress atBottom flips during programmatic smooth-scroll
                if (scrollingToBottomRef.current) return

                if (isNearBottom !== atBottomRef.current) {
                    atBottomRef.current = isNearBottom
                    onAtBottomChangeRef.current(isNearBottom)
                    if (isNearBottom) {
                        onFlushPendingRef.current()
                    }
                }
            })
        }

        viewport.addEventListener('scroll', handleScroll, { passive: true })
        return () => {
            viewport.removeEventListener('scroll', handleScroll)
            if (rafId !== null) cancelAnimationFrame(rafId)
        }
    }, []) // Stable: no dependencies, reads from refs

    // Scroll to bottom handler for the indicator button
    const scrollToBottom = useCallback(() => {
        const viewport = viewportRef.current
        if (viewport) {
            scrollingToBottomRef.current = true
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
        }
        setAutoScrollEnabled(true)
        if (!atBottomRef.current) {
            atBottomRef.current = true
            onAtBottomChangeRef.current(true)
        }
        onFlushPendingRef.current()
    }, [])

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom])

    // Reset state when session changes
    useEffect(() => {
        setAutoScrollEnabled(true)
        atBottomRef.current = true
        onAtBottomChangeRef.current(true)
        forceScrollTokenRef.current = props.forceScrollToken
    }, [props.sessionId])

    useEffect(() => {
        if (forceScrollTokenRef.current === props.forceScrollToken) {
            return
        }
        forceScrollTokenRef.current = props.forceScrollToken
        scrollToBottom()
    }, [props.forceScrollToken, scrollToBottom])

    const handleLoadMore = useCallback(() => {
        if (atBottomRef.current || isLoadingMessagesRef.current || !hasMoreMessagesRef.current || isLoadingMoreRef.current || loadLockRef.current) {
            return
        }
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }
        pendingScrollRef.current = {
            scrollTop: viewport.scrollTop,
            scrollHeight: viewport.scrollHeight
        }
        loadLockRef.current = true
        loadStartedRef.current = false
        let loadPromise: Promise<unknown>
        try {
            loadPromise = onLoadMoreRef.current()
        } catch (error) {
            pendingScrollRef.current = null
            loadLockRef.current = false
            throw error
        }
        void loadPromise.catch((error) => {
            pendingScrollRef.current = null
            loadLockRef.current = false
            console.error('Failed to load older messages:', error)
        }).finally(() => {
            // Always schedule a safety release: if the lock hasn't been cleared
            // by useLayoutEffect (scroll restoration) within a reasonable time,
            // release it to prevent deadlock from ref-update race conditions.
            setTimeout(() => {
                if (loadLockRef.current && pendingScrollRef.current) {
                    pendingScrollRef.current = null
                    loadLockRef.current = false
                }
            }, 500)
        })
    }, [])

    useEffect(() => {
        handleLoadMoreRef.current = handleLoadMore
    }, [handleLoadMore])

    useEffect(() => {
        const sentinel = topSentinelRef.current
        const viewport = viewportRef.current
        if (!sentinel || !viewport || !props.hasMoreMessages || props.isLoadingMessages) {
            return
        }
        if (typeof IntersectionObserver === 'undefined') {
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        handleLoadMoreRef.current()
                    }
                }
            },
            {
                root: viewport,
                rootMargin: '200px 0px 0px 0px'
            }
        )

        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [props.hasMoreMessages, props.isLoadingMessages])

    // Restore scroll position after loading older messages (double-check with rAF)
    useLayoutEffect(() => {
        const pending = pendingScrollRef.current
        const viewport = viewportRef.current
        if (!pending || !viewport) {
            return
        }
        const delta = viewport.scrollHeight - pending.scrollHeight
        viewport.scrollTop = pending.scrollTop + delta
        pendingScrollRef.current = null
        loadLockRef.current = false
        // Double-check after browser paint to handle late layout shifts
        requestAnimationFrame(() => {
            if (viewport) {
                const newDelta = viewport.scrollHeight - pending.scrollHeight
                if (Math.abs(newDelta - delta) > 2) {
                    viewport.scrollTop = pending.scrollTop + newDelta
                }
            }
        })
    }, [props.messagesVersion])

    useEffect(() => {
        isLoadingMoreRef.current = props.isLoadingMoreMessages
        if (props.isLoadingMoreMessages) {
            loadStartedRef.current = true
        }
        if (prevLoadingMoreRef.current && !props.isLoadingMoreMessages && pendingScrollRef.current) {
            pendingScrollRef.current = null
            loadLockRef.current = false
        }
        prevLoadingMoreRef.current = props.isLoadingMoreMessages
    }, [props.isLoadingMoreMessages])

    const showSkeleton = props.isLoadingMessages && props.rawMessagesCount === 0 && props.pendingCount === 0

    // Scroll to bottom on first meaningful content render (before paint)
    const hasScrolledInitially = useRef(false)
    useLayoutEffect(() => {
        if (showSkeleton || blocks.length === 0) {
            hasScrolledInitially.current = false
            return
        }
        if (!hasScrolledInitially.current) {
            hasScrolledInitially.current = true
            const viewport = viewportRef.current
            if (viewport) {
                viewport.scrollTop = viewport.scrollHeight
            }
        }
    }, [showSkeleton, blocks.length])

    // Auto-scroll to bottom when content height changes (new blocks OR streaming text)
    const contentRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        const content = contentRef.current
        const viewport = viewportRef.current
        if (!content || !viewport) return

        let rafId: number | null = null
        const ro = new ResizeObserver(() => {
            if (!autoScrollEnabledRef.current) return
            if (rafId !== null) return
            rafId = requestAnimationFrame(() => {
                rafId = null
                viewport.scrollTop = viewport.scrollHeight
            })
        })
        ro.observe(content)
        return () => {
            ro.disconnect()
            if (rafId !== null) cancelAnimationFrame(rafId)
        }
    }, [showSkeleton]) // Re-run when skeleton ↔ content transitions

    const chatContextValue = useMemo(() => ({
        api: props.api,
        sessionId: props.sessionId,
        metadata: props.metadata,
        disabled: props.disabled,
        onRefresh: props.onRefresh,
        onRetryMessage: props.onRetryMessage
    }), [props.api, props.sessionId, props.metadata, props.disabled, props.onRefresh, props.onRetryMessage])

    return (
        <HappyChatProvider value={chatContextValue}>
            <div className="flex min-h-0 flex-1 flex-col relative">
                <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                    <div className="mx-auto w-full max-w-content min-w-0 p-3">
                        <div ref={topSentinelRef} className="h-px w-full" aria-hidden="true" />
                        {showSkeleton ? (
                            <MessageSkeleton />
                        ) : (
                            <>
                                {props.messagesWarning ? (
                                    <div className="mb-3 rounded-md bg-amber-500/10 p-2 text-xs">
                                        {props.messagesWarning}
                                    </div>
                                ) : null}

                                {props.hasMoreMessages && !props.isLoadingMessages ? (
                                    <div className={`py-1 mb-2${props.disabled ? ' mt-8' : ''}`}>
                                        <div className="mx-auto w-fit">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleLoadMore}
                                                disabled={props.isLoadingMoreMessages || props.isLoadingMessages}
                                                aria-busy={props.isLoadingMoreMessages}
                                                className="gap-1.5 text-xs opacity-80 hover:opacity-100"
                                            >
                                                {props.isLoadingMoreMessages ? (
                                                    <>
                                                        <Spinner size="sm" label={null} className="text-current" />
                                                        {t('misc.loading')}
                                                    </>
                                                ) : (
                                                    <>
                                                        <span aria-hidden="true">↑</span>
                                                        {t('misc.loadOlder')}
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}

                                {import.meta.env.DEV && props.normalizedMessagesCount === 0 && props.rawMessagesCount > 0 ? (
                                    <div className="mb-2 rounded-md bg-amber-500/10 p-2 text-xs">
                                        Message normalization returned 0 items for {props.rawMessagesCount} messages (see `web/src/chat/normalize.ts`).
                                    </div>
                                ) : null}

                                <div ref={contentRef} className="flex flex-col gap-3">
                                    {blocks.map((block, index) => (
                                        <div key={block.id}>
                                            {renderBlock(block, index === blocks.length - 1, isRunning)}
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </HappyChatProvider>
    )
})
