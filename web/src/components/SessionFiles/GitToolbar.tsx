type GitToolbarProps = {
    onFetch: () => void
    onPull: () => void
    onPush: () => void
    onStash: () => void
    loading: 'fetch' | 'pull' | 'push' | null
    error: string | null
    onDismissError: () => void
}

function ToolbarButton({ label, onClick, isLoading, disabled }: {
    label: string
    onClick: () => void
    isLoading: boolean
    disabled: boolean
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
            {isLoading && (
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            )}
            {label}
        </button>
    )
}

export function GitToolbar({ onFetch, onPull, onPush, onStash, loading, error, onDismissError }: GitToolbarProps) {
    const anyLoading = loading !== null

    return (
        <div>
            <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto">
                <ToolbarButton label="Fetch" onClick={onFetch} isLoading={loading === 'fetch'} disabled={anyLoading} />
                <ToolbarButton label="Pull" onClick={onPull} isLoading={loading === 'pull'} disabled={anyLoading} />
                <ToolbarButton label="Push" onClick={onPush} isLoading={loading === 'push'} disabled={anyLoading} />
                <ToolbarButton label="Stash" onClick={onStash} isLoading={false} disabled={anyLoading} />
            </div>
            {error && (
                <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-xs flex items-center justify-between">
                    <span className="truncate">{error}</span>
                    <button type="button" onClick={onDismissError} className="shrink-0 ml-2 hover:opacity-70">&times;</button>
                </div>
            )}
        </div>
    )
}
