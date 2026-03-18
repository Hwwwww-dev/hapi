import type { CommitEntry } from '@/types/api'

function formatRelativeTime(timestamp: number): string {
    const now = Date.now() / 1000
    const diff = now - timestamp
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
    return new Date(timestamp * 1000).toLocaleDateString()
}

export function CommitRow({ commit }: { commit: CommitEntry }) {
    return (
        <div className="flex items-start gap-3 py-2 px-4">
            <div className="flex flex-col items-center pt-1.5">
                <div className="w-2 h-2 rounded-full bg-[var(--app-link)]" />
                <div className="w-px flex-1 bg-[var(--app-border)]" />
            </div>
            <div className="flex-1 min-w-0 pb-4">
                <div className="text-sm text-[var(--app-fg)] truncate">{commit.subject}</div>
                <div className="text-xs text-[var(--app-hint)] mt-0.5">
                    <span className="font-mono">{commit.short}</span>
                    <span className="mx-1">·</span>
                    <span>{commit.author}</span>
                    <span className="mx-1">·</span>
                    <span>{formatRelativeTime(commit.date)}</span>
                </div>
            </div>
        </div>
    )
}
