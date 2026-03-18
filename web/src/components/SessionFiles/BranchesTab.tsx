import { useState } from 'react'
import type { ApiClient } from '@/api/client'
import { useGitBranches } from '@/hooks/queries/useGitBranches'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
import type { GitBranchEntry } from '@/types/api'

type BranchesTabProps = {
    api: ApiClient
    sessionId: string
    currentBranch: string | null
    onBranchChanged: () => void
}

export function BranchesTab({ api, sessionId, currentBranch, onBranchChanged }: BranchesTabProps) {
    const { t } = useTranslation()
    const [searchQuery, setSearchQuery] = useState('')
    const [showCreateInput, setShowCreateInput] = useState(false)
    const [newBranchName, setNewBranchName] = useState('')
    const [newBranchFrom, setNewBranchFrom] = useState('')
    const [actionLoading, setActionLoading] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [localExpanded, setLocalExpanded] = useState(true)
    const [remoteExpanded, setRemoteExpanded] = useState(true)
    const [confirmBranch, setConfirmBranch] = useState<GitBranchEntry | null>(null)

    const { local, remote, isLoading, error: fetchError, refetch } = useGitBranches(api, sessionId, currentBranch)

    const q = searchQuery.trim().toLowerCase()
    const filteredLocal = q ? local.filter(b => b.name.toLowerCase().includes(q)) : local
    const filteredRemote = q ? remote.filter(b => b.name.toLowerCase().includes(q)) : remote

    const handleCheckout = async (branch: GitBranchEntry) => {
        if (branch.isCurrent) return
        setConfirmBranch(branch)
    }

    const executeCheckout = async () => {
        if (!confirmBranch) return
        setActionLoading(confirmBranch.name)
        setError(null)
        try {
            const res = await api.gitCheckout(sessionId, confirmBranch.name)
            if (res.success) {
                setConfirmBranch(null)
                await refetch()
                onBranchChanged()
            } else {
                const msg = res.stderr ?? res.error ?? 'Checkout failed'
                setError(msg)
                throw new Error(msg)
            }
        } finally {
            setActionLoading(null)
        }
    }

    const handleCreateBranch = async () => {
        const name = newBranchName.trim()
        if (!name) return
        setActionLoading('create')
        setError(null)
        try {
            const res = await api.gitCreateBranch(sessionId, name, newBranchFrom.trim() || undefined)
            if (res.success) {
                setNewBranchName('')
                setNewBranchFrom('')
                setShowCreateInput(false)
                await refetch()
                onBranchChanged()
            } else {
                setError(res.stderr ?? res.error ?? 'Create branch failed')
            }
        } finally {
            setActionLoading(null)
        }
    }

    return (
        <div className="flex flex-col h-full relative">
            {/* Search */}
            <div className="px-3 pt-3 pb-2">
                <input
                    type="text"
                    placeholder="Search branches..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
                />
            </div>

            {/* Error */}
            {(error || fetchError) && (
                <div className="mx-3 mb-2 px-3 py-2 text-xs text-red-500 bg-red-500/10 rounded border border-red-500/20">
                    {error ?? String(fetchError)}
                </div>
            )}

            {/* Branch list */}
            <div className="flex-1 overflow-y-auto pb-16">
                {isLoading ? (
                    <div className="px-3 py-4 text-sm text-[var(--app-hint)]">Loading...</div>
                ) : (
                    <>
                        {/* Local section */}
                        <div>
                            <button
                                type="button"
                                onClick={() => setLocalExpanded(v => !v)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                            >
                                <span>{localExpanded ? '▼' : '▶'}</span>
                                <span>Local ({filteredLocal.length})</span>
                            </button>
                            {localExpanded && filteredLocal.map(branch => (
                                <BranchRow
                                    key={branch.name}
                                    branch={branch}
                                    loading={actionLoading === branch.name}
                                    onClick={() => handleCheckout(branch)}
                                />
                            ))}
                        </div>

                        {/* Remote section */}
                        <div>
                            <button
                                type="button"
                                onClick={() => setRemoteExpanded(v => !v)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                            >
                                <span>{remoteExpanded ? '▼' : '▶'}</span>
                                <span>Remote ({filteredRemote.length})</span>
                            </button>
                            {remoteExpanded && filteredRemote.map(branch => (
                                <BranchRow
                                    key={branch.name}
                                    branch={branch}
                                    loading={actionLoading === branch.name}
                                    onClick={() => handleCheckout(branch)}
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Fixed bottom: New Branch */}
            <div className="absolute bottom-0 left-0 right-0 border-t border-[var(--app-divider)] bg-[var(--app-bg)]">
                {showCreateInput ? (
                    <div className="px-3 py-3 flex flex-col gap-2">
                        <input
                            type="text"
                            placeholder="Branch name"
                            value={newBranchName}
                            onChange={e => setNewBranchName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleCreateBranch()}
                            autoFocus
                            className="w-full text-sm px-3 py-2 rounded border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
                        />
                        <input
                            type="text"
                            placeholder="From (optional, branch or commit)"
                            value={newBranchFrom}
                            onChange={e => setNewBranchFrom(e.target.value)}
                            className="w-full text-sm px-3 py-2 rounded border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
                        />
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={handleCreateBranch}
                                disabled={!newBranchName.trim() || actionLoading === 'create'}
                                className="flex-1 min-h-[44px] text-sm font-medium rounded bg-[var(--app-link)] text-white disabled:opacity-50 transition-opacity"
                            >
                                {actionLoading === 'create' ? 'Creating...' : 'Create'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowCreateInput(false); setNewBranchName(''); setNewBranchFrom(''); setError(null) }}
                                className="px-4 min-h-[44px] text-sm rounded border border-[var(--app-border)] text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setShowCreateInput(true)}
                        className="w-full min-h-[44px] text-sm text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                    >
                        + New Branch
                    </button>
                )}
            </div>
            <ConfirmDialog
                isOpen={confirmBranch !== null}
                onClose={() => setConfirmBranch(null)}
                title={t('dialog.git.checkout.title')}
                description={t('dialog.git.checkout.description', { branch: confirmBranch?.name ?? '' })}
                confirmLabel={t('dialog.git.checkout.confirm')}
                confirmingLabel={t('dialog.git.checkout.confirming')}
                onConfirm={executeCheckout}
                isPending={actionLoading !== null}
            />
        </div>
    )
}

function BranchRow({ branch, loading, onClick }: { branch: GitBranchEntry; loading: boolean; onClick: () => void }) {
    const isClickable = !branch.isCurrent

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!isClickable || loading}
            className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left transition-colors min-h-[44px]
                ${isClickable ? 'hover:bg-[var(--app-subtle-bg)] cursor-pointer' : 'cursor-default'}
                ${branch.isCurrent ? 'bg-[var(--app-link)]/10 text-[var(--app-link)] font-semibold' : 'text-[var(--app-fg)]'}
                ${branch.isRemote ? 'text-[var(--app-hint)]' : ''}
            `}
        >
            {branch.isCurrent ? (
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            ) : (
                <span className="w-2 h-2 shrink-0" />
            )}
            <span className="truncate flex-1">{branch.name}</span>
            {loading && <span className="text-xs text-[var(--app-hint)] shrink-0">...</span>}
        </button>
    )
}
