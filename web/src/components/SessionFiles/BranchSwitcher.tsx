import { useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'

interface Props {
    api: ApiClient
    sessionId: string
    currentBranch: string
    hasBlockingChanges: boolean
    onSwitched: () => void
}

export function BranchSwitcher({ api, sessionId, currentBranch, hasBlockingChanges, onSwitched }: Props) {
    const [open, setOpen] = useState(false)
    const [branches, setBranches] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [switching, setSwitching] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [open])

    const handleOpen = async () => {
        setOpen(true)
        setError(null)
        // 已有缓存则不重新请求
        if (branches.length > 0) return
        setLoading(true)
        const res = await api.getGitBranches(sessionId)
        setLoading(false)
        if (res.success && res.stdout) {
            setBranches(res.stdout.split('\n').map(b => b.trim()).filter(Boolean))
        } else {
            setError(res.error ?? 'Failed to load branches')
        }
    }

    const handleSelect = async (branch: string) => {
        if (branch === currentBranch) { setOpen(false); return }
        if (hasBlockingChanges) {
            setError('You have uncommitted changes. Please commit or stash them before switching branches.')
            return
        }
        setSwitching(true)
        setError(null)
        const res = await api.gitCheckout(sessionId, branch)
        setSwitching(false)
        if (res.success) {
            setOpen(false)
            onSwitched()
        } else {
            setError(res.stderr ?? res.error ?? 'Checkout failed')
        }
    }

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={handleOpen}
                className="text-xs px-2 py-0.5 rounded border border-[var(--app-border)] hover:bg-[var(--app-subtle-bg)] text-[var(--app-hint)]"
            >
                switch
            </button>
            {open && (
                <div className="absolute top-7 left-0 z-50 bg-[var(--app-bg)] border border-[var(--app-border)] rounded shadow-md min-w-40 max-h-60 overflow-y-auto">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--app-divider)]">
                        <span className="text-xs font-semibold">Branches</span>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="text-xs text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                        >
                            ✕
                        </button>
                    </div>
                    {error && <div className="px-2 py-1.5 text-xs text-red-500">{error}</div>}
                    {loading && <div className="px-2 py-1.5 text-xs text-[var(--app-hint)]">Loading...</div>}
                    {!loading && branches.map(b => (
                        <button
                            key={b}
                            type="button"
                            onClick={() => handleSelect(b)}
                            disabled={switching}
                            className={`w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--app-subtle-bg)] transition-colors ${b === currentBranch ? 'font-semibold text-[var(--app-link)]' : 'text-[var(--app-fg)]'}`}
                        >
                            {b === currentBranch ? `✓ ${b}` : b}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
