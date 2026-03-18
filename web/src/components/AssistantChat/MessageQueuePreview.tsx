import type { QueuedMessage } from '@/hooks/useMessageQueue'

function truncate(text: string, max = 80): string {
    return text.length > max ? text.slice(0, max) + '...' : text
}

export function MessageQueuePreview(props: {
    queue: QueuedMessage[]
    onRemove: (id: string) => void
    onEdit: (item: QueuedMessage) => void
    onFlush: () => void
    titleLabel: string
    flushLabel: string
}) {
    const { queue, onRemove, onEdit, onFlush, titleLabel, flushLabel } = props

    if (queue.length === 0) return null

    return (
        <div className="border-b border-[var(--app-divider)] animate-drawer-up">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5">
                <span className="text-xs font-medium text-[var(--app-hint)]">
                    {titleLabel} ({queue.length})
                </span>
                <button
                    type="button"
                    className="rounded-md px-2.5 py-0.5 text-xs font-medium text-[var(--app-accent)] hover:bg-[var(--app-hover)] cursor-pointer transition-colors"
                    onClick={onFlush}
                >
                    {flushLabel}
                </button>
            </div>

            {/* Scrollable message list */}
            <div className="max-h-[160px] overflow-y-auto px-2 pb-2">
                {queue.map((item, index) => (
                    <div
                        key={item.id}
                        className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--app-hover)] transition-colors"
                    >
                        <span className="mt-0.5 shrink-0 text-[10px] tabular-nums text-[var(--app-hint)]">
                            {index + 1}
                        </span>
                        <button
                            type="button"
                            className="min-w-0 flex-1 text-left text-xs leading-relaxed text-[var(--app-fg)] hover:underline cursor-pointer break-words"
                            onClick={() => onEdit(item)}
                        >
                            {truncate(item.text)}
                        </button>
                        <button
                            type="button"
                            aria-label="remove"
                            className="mt-0.5 shrink-0 rounded p-0.5 text-[var(--app-hint)] opacity-0 group-hover:opacity-100 hover:text-[var(--app-fg)] hover:bg-[var(--app-hover)] cursor-pointer transition-opacity"
                            onClick={(e) => {
                                e.stopPropagation()
                                onRemove(item.id)
                            }}
                        >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                <path d="M3 3l6 6M9 3l-6 6" />
                            </svg>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )
}
