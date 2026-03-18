import { useState } from 'react'
import type { ApiClient } from '@/api/client'
import { useGitStashList } from '@/hooks/queries/useGitStashList'

type StashSheetProps = {
    api: ApiClient
    sessionId: string
    open: boolean
    onClose: () => void
    onStashChanged: () => void
}

export function StashSheet({ api, sessionId, open, onClose, onStashChanged }: StashSheetProps) {
    const [stashMessage, setStashMessage] = useState('')
    const [actionLoading, setActionLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const { stashes, refetch } = useGitStashList(api, sessionId)

    if (!open) return null

    const handleStash = async () => {
        setActionLoading(true)
        setError(null)
        const res = await api.gitStash(sessionId, stashMessage.trim() || undefined)
        setActionLoading(false)
        if (res.success) {
            setStashMessage('')
            onStashChanged()
            refetch()
        } else {
            setError(res.stderr ?? res.error ?? 'Stash failed')
        }
    }

    const handlePop = async (index: number) => {
        setActionLoading(true)
        setError(null)
        const res = await api.gitStashPop(sessionId, index)
        setActionLoading(false)
        if (res.success) {
            onStashChanged()
            refetch()
        } else {
            setError(res.stderr ?? res.error ?? 'Pop failed')
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40"
                onClick={onClose}
            />

            {/* Sheet */}
            <div className="relative w-full bg-[var(--app-bg)] rounded-t-2xl flex flex-col max-h-[60vh] translate-y-0 transition-transform duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--app-divider)]">
                    <span className="text-sm font-semibold text-[var(--app-fg)]">Stash</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                {/* Push section */}
                <div className="px-4 py-3 border-b border-[var(--app-divider)] flex flex-col gap-2">
                    <input
                        type="text"
                        value={stashMessage}
                        onChange={e => setStashMessage(e.target.value)}
                        placeholder="Optional message..."
                        className="text-xs border border-[var(--app-border)] rounded p-2 bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:border-[var(--app-link)]"
                    />
                    {error && <div className="text-xs text-red-500">{error}</div>}
                    <button
                        type="button"
                        onClick={handleStash}
                        disabled={actionLoading}
                        className="min-h-[44px] text-sm px-3 rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-40 hover:opacity-90 transition-opacity"
                    >
                        {actionLoading ? 'Working...' : 'Stash Changes'}
                    </button>
                </div>

                {/* List section */}
                <div className="overflow-y-auto flex-1">
                    {stashes.length === 0 ? (
                        <div className="px-4 py-6 text-xs text-[var(--app-hint)] text-center">No stashes</div>
                    ) : (
                        stashes.map(entry => (
                            <div
                                key={entry.index}
                                className="flex items-center justify-between px-4 py-2 border-b border-[var(--app-divider)] last:border-0"
                            >
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-2">
                                    <span className="text-xs text-[var(--app-hint)]">stash@{`{${entry.index}}`}</span>
                                    <span className="text-xs text-[var(--app-fg)] truncate">{entry.message}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handlePop(entry.index)}
                                    disabled={actionLoading}
                                    className="min-h-[44px] min-w-[44px] text-xs px-3 rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40 transition-colors shrink-0"
                                >
                                    Pop
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}
