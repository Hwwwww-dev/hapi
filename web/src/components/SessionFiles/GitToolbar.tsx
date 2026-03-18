import { useTranslation } from '@/lib/use-translation'

type GitToolbarProps = {
    onFetch: () => void
    onPull: () => void
    onPush: () => void
    onStash: () => void
    loading: 'fetch' | 'pull' | 'push' | null
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

export function GitToolbar({ onFetch, onPull, onPush, onStash, loading }: GitToolbarProps) {
    const { t } = useTranslation()
    const anyLoading = loading !== null

    return (
        <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto">
            <ToolbarButton label={t('git.fetch')} onClick={onFetch} isLoading={loading === 'fetch'} disabled={anyLoading} />
            <ToolbarButton label={t('git.pull')} onClick={onPull} isLoading={loading === 'pull'} disabled={anyLoading} />
            <ToolbarButton label={t('git.push')} onClick={onPush} isLoading={loading === 'push'} disabled={anyLoading} />
            <ToolbarButton label={t('git.stash')} onClick={onStash} isLoading={false} disabled={anyLoading} />
        </div>
    )
}
