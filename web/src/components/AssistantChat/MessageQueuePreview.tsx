import { IconClose } from '@arco-design/web-react/icon'
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
            <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5 max-sm:px-3 max-sm:pt-2 max-sm:pb-1">
                <span className="text-[length:var(--text-caption)] font-medium text-[var(--app-hint)]">
                    {titleLabel} ({queue.length})
                </span>
                <button
                    type="button"
                    className="rounded-md px-2.5 py-0.5 text-[length:var(--text-caption)] font-medium text-[var(--app-accent)] transition-colors hover:bg-[var(--app-hover)] cursor-pointer"
                    onClick={onFlush}
                >
                    {flushLabel}
                </button>
            </div>

            <div className="max-h-[160px] overflow-y-auto px-2 pb-2 max-sm:px-1.5 max-sm:pb-1.5">
                {queue.map((item, index) => (
                    <div
                        key={item.id}
                        className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--app-hover)] max-sm:gap-1.5 max-sm:px-1.5 max-sm:py-1"
                    >
                        <span className="mt-0.5 shrink-0 text-[length:var(--text-badge)] tabular-nums text-[var(--app-hint)]">
                            {index + 1}
                        </span>
                        <button
                            type="button"
                            className="min-w-0 flex-1 break-words text-left text-[length:var(--text-body)] leading-relaxed text-[var(--app-fg)] hover:underline cursor-pointer"
                            onClick={() => onEdit(item)}
                        >
                            {truncate(item.text)}
                        </button>
                        <button
                            type="button"
                            aria-label="remove"
                            className="mt-0.5 shrink-0 rounded-md p-0.5 text-[var(--app-hint)] opacity-0 transition-opacity hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)] cursor-pointer group-hover:opacity-100"
                            onClick={(e) => {
                                e.stopPropagation()
                                onRemove(item.id)
                            }}
                        >
                            <IconClose style={{ fontSize: 'var(--icon-xs)' }} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )
}
