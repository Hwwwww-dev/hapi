/** @deprecated Use ChangesTab instead. Kept for reference during migration. */
import { useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { GitStatusFiles } from '@/types/api'

interface Props {
    api: ApiClient
    sessionId: string
    gitStatus: GitStatusFiles
    onCommitted: () => void
    onStaged: () => void
    onClose: () => void
}

export function CommitDrawer({ api, sessionId, gitStatus, onCommitted, onStaged, onClose }: Props) {
    const [message, setMessage] = useState('')
    const [isPending, setIsPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const allFiles = [
        ...gitStatus.stagedFiles.map(f => ({ ...f, isStaged: true as const })),
        ...gitStatus.unstagedFiles.map(f => ({ ...f, isStaged: false as const }))
    ]

    const handleToggle = async (filePath: string, currentlyStaged: boolean) => {
        setError(null)
        const res = await api.gitStage(sessionId, filePath, !currentlyStaged)
        if (res.success) {
            onStaged()
        } else {
            setError(res.stderr ?? res.error ?? 'Stage failed')
        }
    }

    const handleCommit = async () => {
        if (!message.trim() || gitStatus.stagedFiles.length === 0) return
        setIsPending(true)
        setError(null)
        const res = await api.gitCommit(sessionId, message.trim())
        setIsPending(false)
        if (res.success) {
            onCommitted()
            onClose()
        } else {
            setError(res.stderr ?? res.error ?? 'Commit failed')
        }
    }

    return (
        <div className="border-t border-[var(--app-divider)] bg-[var(--app-bg)] p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Commit changes</span>
                <button
                    type="button"
                    onClick={onClose}
                    className="text-xs text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                >
                    ✕
                </button>
            </div>
            <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
                {allFiles.map(f => (
                    <label
                        key={f.fullPath}
                        className="flex items-center gap-2 text-xs cursor-pointer hover:bg-[var(--app-subtle-bg)] px-1 py-0.5 rounded"
                    >
                        <input
                            type="checkbox"
                            checked={f.isStaged}
                            onChange={() => handleToggle(f.fullPath, f.isStaged)}
                            className="cursor-pointer"
                        />
                        <span className={f.isStaged ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}>
                            {f.fullPath}
                        </span>
                    </label>
                ))}
                {allFiles.length === 0 && (
                    <div className="text-xs text-[var(--app-hint)] px-1">No changes to commit.</div>
                )}
            </div>
            <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Commit message..."
                className="text-xs border border-[var(--app-border)] rounded p-1.5 resize-none h-16 bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:border-[var(--app-link)]"
            />
            {error && <div className="text-xs text-red-500">{error}</div>}
            <button
                type="button"
                onClick={handleCommit}
                disabled={isPending || !message.trim() || gitStatus.stagedFiles.length === 0}
                className="text-xs px-3 py-1.5 rounded bg-[var(--app-link)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
                {isPending ? 'Committing...' : `Commit${gitStatus.stagedFiles.length > 0 ? ` (${gitStatus.stagedFiles.length})` : ''}`}
            </button>
        </div>
    )
}
