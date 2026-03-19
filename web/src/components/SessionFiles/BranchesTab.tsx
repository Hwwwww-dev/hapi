import { useState, useRef, useEffect } from 'react'
import type { ApiClient } from '@/api/client'
import { useGitBranches } from '@/hooks/queries/useGitBranches'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
import { notify } from '@/lib/notify'
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
    const [renamingBranch, setRenamingBranch] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [upstreamBranch, setUpstreamBranch] = useState<string | null>(null)
    const [mergeBranch, setMergeBranch] = useState<GitBranchEntry | null>(null)

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
                const msg = res.stderr ?? res.error ?? t('git.checkoutFailed')
                setError(msg)
                notify.error(msg)
                throw new Error(msg)
            }
        } finally {
            setActionLoading(null)
        }
    }

    const handleRename = async (oldName: string) => {
        const newName = renameValue.trim()
        if (!newName || newName === oldName) { setRenamingBranch(null); return }
        setActionLoading(oldName)
        setError(null)
        try {
            const res = await api.gitRenameBranch(sessionId, oldName, newName)
            if (res.success) {
                notify.success(t('notify.git.renameOk'))
                setRenamingBranch(null)
                await refetch()
                onBranchChanged()
            } else {
                const msg = res.stderr ?? res.error ?? t('git.renameFailed')
                setError(msg); notify.error(msg)
            }
        } finally { setActionLoading(null) }
    }

    const handleSetUpstream = async (branch: string, upstream: string) => {
        setActionLoading(branch)
        setError(null)
        try {
            const res = await api.gitSetUpstream(sessionId, branch, upstream)
            if (res.success) {
                notify.success(t('notify.git.setUpstreamOk'))
                setUpstreamBranch(null)
                await refetch()
            } else {
                const msg = res.stderr ?? res.error ?? t('git.setUpstreamFailed')
                setError(msg); notify.error(msg)
            }
        } finally { setActionLoading(null) }
    }

    const executeMerge = async () => {
        if (!mergeBranch) return
        setActionLoading(mergeBranch.name)
        setError(null)
        try {
            const res = await api.gitMerge(sessionId, mergeBranch.name)
            if (res.success) {
                notify.success(t('notify.git.mergeOk'))
                setMergeBranch(null)
                await refetch()
                onBranchChanged()
            } else {
                const msg = res.stderr ?? res.error ?? t('git.mergeFailed')
                setError(msg); notify.error(msg)
            }
        } finally { setActionLoading(null) }
    }

    const handleDelete = async (branch: GitBranchEntry) => {
        setActionLoading(branch.name)
        setError(null)
        try {
            const res = await api.gitDeleteBranch(sessionId, branch.name)
            if (res.success) {
                await refetch()
                onBranchChanged()
            } else {
                const msg = res.stderr ?? res.error ?? t('git.deleteFailed')
                setError(msg); notify.error(msg)
            }
        } finally { setActionLoading(null) }
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
                const msg = res.stderr ?? res.error ?? t('git.createBranchFailed')
                setError(msg)
                notify.error(msg)
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
                    placeholder={t('git.searchBranches')}
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
                    <div className="px-3 py-4 text-sm text-[var(--app-hint)]">{t('git.loading')}</div>
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
                                <span>{t('git.localBranches', { n: filteredLocal.length })}</span>
                            </button>
                            {localExpanded && filteredLocal.map(branch => (
                                <BranchRow
                                    key={branch.name}
                                    branch={branch}
                                    currentBranch={currentBranch}
                                    loading={actionLoading === branch.name}
                                    isRenaming={renamingBranch === branch.name}
                                    renameValue={renamingBranch === branch.name ? renameValue : ''}
                                    remoteBranches={remote}
                                    upstreamBranch={upstreamBranch}
                                    onClick={() => handleCheckout(branch)}
                                    onRenameChange={setRenameValue}
                                    onRenameSubmit={() => handleRename(branch.name)}
                                    onRenameCancel={() => setRenamingBranch(null)}
                                    onStartRename={() => { setRenamingBranch(branch.name); setRenameValue(branch.name) }}
                                    onStartUpstream={() => setUpstreamBranch(branch.name)}
                                    onSelectUpstream={(upstream) => handleSetUpstream(branch.name, upstream)}
                                    onCancelUpstream={() => setUpstreamBranch(null)}
                                    onMerge={() => setMergeBranch(branch)}
                                    onDelete={() => handleDelete(branch)}
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
                                <span>{t('git.remoteBranches', { n: filteredRemote.length })}</span>
                            </button>
                            {remoteExpanded && filteredRemote.map(branch => (
                                <BranchRow
                                    key={branch.name}
                                    branch={branch}
                                    currentBranch={currentBranch}
                                    loading={actionLoading === branch.name}
                                    isRenaming={false}
                                    renameValue=""
                                    remoteBranches={remote}
                                    upstreamBranch={upstreamBranch}
                                    onClick={() => handleCheckout(branch)}
                                    onRenameChange={() => {}}
                                    onRenameSubmit={() => {}}
                                    onRenameCancel={() => {}}
                                    onStartRename={() => {}}
                                    onStartUpstream={() => {}}
                                    onSelectUpstream={() => {}}
                                    onCancelUpstream={() => {}}
                                    onMerge={() => setMergeBranch(branch)}
                                    onDelete={() => handleDelete(branch)}
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
                            placeholder={t('git.branchName')}
                            value={newBranchName}
                            onChange={e => setNewBranchName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleCreateBranch()}
                            autoFocus
                            className="w-full text-sm px-3 py-2 rounded border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
                        />
                        <input
                            type="text"
                            placeholder={t('git.branchFrom')}
                            value={newBranchFrom}
                            onChange={e => setNewBranchFrom(e.target.value)}
                            className="w-full text-sm px-3 py-2 rounded border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
                        />
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={handleCreateBranch}
                                disabled={!newBranchName.trim() || actionLoading === 'create'}
                                className="flex-1 min-h-[44px] text-sm font-medium rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50 transition-opacity"
                            >
                                {actionLoading === 'create' ? t('git.creating') : t('git.create')}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowCreateInput(false); setNewBranchName(''); setNewBranchFrom(''); setError(null) }}
                                className="px-4 min-h-[44px] text-sm rounded border border-[var(--app-border)] text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                            >
                                {t('button.cancel')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setShowCreateInput(true)}
                        className="w-full min-h-[44px] text-sm text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                    >
                        {t('git.newBranch')}
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
            <ConfirmDialog
                isOpen={mergeBranch !== null}
                onClose={() => setMergeBranch(null)}
                title={t('dialog.git.merge.title')}
                description={t('dialog.git.merge.description', { branch: mergeBranch?.name ?? '' })}
                confirmLabel={t('dialog.git.merge.confirm')}
                confirmingLabel={t('dialog.git.merge.confirming')}
                onConfirm={executeMerge}
                isPending={actionLoading !== null}
            />
        </div>
    )
}
function BranchActionMenu({ branch, currentBranch, onRename, onSetUpstream, onMerge, onDelete }: {
    branch: GitBranchEntry
    currentBranch: string | null
    onRename: () => void
    onSetUpstream: () => void
    onMerge: () => void
    onDelete: () => void
}) {
    const [open, setOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const { t } = useTranslation()

    useEffect(() => {
        if (!open) return
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    const isLocal = !branch.isRemote
    const isNotCurrent = !branch.isCurrent

    return (
        <div className="relative shrink-0" ref={menuRef}>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
            >
                ⋯
            </button>
            {open && (
                <div className="animate-fade-in-scale absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1 shadow-lg">
                    {isLocal && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onRename() }}
                            className="w-full px-3 py-1.5 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors">
                            {t('git.rename')}
                        </button>
                    )}
                    {isLocal && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onSetUpstream() }}
                            className="w-full px-3 py-1.5 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors">
                            {t('git.setUpstream')}
                        </button>
                    )}
                    {isNotCurrent && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onMerge() }}
                            className="w-full px-3 py-1.5 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors">
                            {t('git.mergeTo')}
                        </button>
                    )}
                    {isNotCurrent && (
                        <>
                            <div className="my-1 border-t border-[var(--app-divider)]" />
                            <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete() }}
                                className="w-full px-3 py-1.5 text-left text-xs text-red-500 hover:bg-[var(--app-subtle-bg)] transition-colors">
                                {t('git.delete')}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
function BranchRow({ branch, currentBranch, loading, isRenaming, renameValue, remoteBranches, upstreamBranch, onClick,
    onRenameChange, onRenameSubmit, onRenameCancel, onStartRename, onStartUpstream, onSelectUpstream, onCancelUpstream, onMerge, onDelete,
}: {
    branch: GitBranchEntry; currentBranch: string | null; loading: boolean
    isRenaming: boolean; renameValue: string; remoteBranches: GitBranchEntry[]
    upstreamBranch: string | null
    onClick: () => void
    onRenameChange: (v: string) => void; onRenameSubmit: () => void; onRenameCancel: () => void
    onStartRename: () => void; onStartUpstream: () => void
    onSelectUpstream: (upstream: string) => void; onCancelUpstream: () => void
    onMerge: () => void; onDelete: () => void
}) {
    const isClickable = !branch.isCurrent
    const showUpstreamPicker = upstreamBranch === branch.name
    const upstreamRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!showUpstreamPicker) return
        const handler = (e: MouseEvent) => {
            if (upstreamRef.current && !upstreamRef.current.contains(e.target as Node)) onCancelUpstream()
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [showUpstreamPicker, onCancelUpstream])

    return (
        <div className="relative">
            <div
                onClick={isRenaming ? undefined : onClick}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left transition-colors min-h-[44px]
                    ${isClickable && !isRenaming ? 'hover:bg-[var(--app-subtle-bg)] cursor-pointer' : 'cursor-default'}
                    ${branch.isCurrent ? 'bg-[var(--app-link)]/10 text-[var(--app-link)] font-semibold' : 'text-[var(--app-fg)]'}
                    ${branch.isRemote ? 'text-[var(--app-hint)]' : ''}
                `}
            >
                {branch.isCurrent ? (
                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                ) : (
                    <span className="w-2 h-2 shrink-0" />
                )}
                {isRenaming ? (
                    <input
                        type="text"
                        value={renameValue}
                        onChange={e => onRenameChange(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameCancel() }}
                        onBlur={onRenameCancel}
                        autoFocus
                        className="flex-1 text-sm px-2 py-0.5 rounded border border-[var(--app-link)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] outline-none"
                        onClick={e => e.stopPropagation()}
                    />
                ) : (
                    <span className="truncate flex-1">{branch.name}</span>
                )}
                {loading && <span className="text-xs text-[var(--app-hint)] shrink-0">...</span>}
                {!isRenaming && (
                    <BranchActionMenu
                        branch={branch}
                        currentBranch={currentBranch}
                        onRename={onStartRename}
                        onSetUpstream={onStartUpstream}
                        onMerge={onMerge}
                        onDelete={onDelete}
                    />
                )}
            </div>
            {showUpstreamPicker && (
                <div ref={upstreamRef} className="animate-fade-in-scale absolute left-8 right-2 top-full z-20 mt-1 max-h-[200px] overflow-y-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1 shadow-lg">
                    {remoteBranches.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-[var(--app-hint)]">No remote branches</div>
                    ) : remoteBranches.map(rb => (
                        <button key={rb.name} type="button"
                            onClick={(e) => { e.stopPropagation(); onSelectUpstream(rb.name) }}
                            className="w-full px-3 py-1.5 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors truncate">
                            {rb.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}