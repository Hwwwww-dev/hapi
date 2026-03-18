import type { QueuedMessage } from '@/hooks/useMessageQueue'

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

    if (queue.length === 0) return null

    const flushLabel = isRunning ? '中止并发送' : '发送全部'

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
                aria-label={flushLabel}
                className="shrink-0 rounded-full bg-[var(--app-link)] px-3 py-1 text-xs text-white hover:opacity-90 cursor-pointer"
                onClick={onFlush}
            >
                {flushLabel}
            </button>
        </div>
    )
}
