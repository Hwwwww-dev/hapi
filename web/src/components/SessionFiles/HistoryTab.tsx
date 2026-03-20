import { useState, useEffect, useRef, useCallback } from 'react'
import type { ApiClient } from '@/api/client'
import type { CommitEntry } from '@/types/api'
import { useGitLog } from '@/hooks/queries/useGitLog'
import { useGitTags } from '@/hooks/queries/useGitTags'
import { useGitBranches } from '@/hooks/queries/useGitBranches'
import { useTranslation } from '@/lib/use-translation'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { notify } from '@/lib/notify'
import { CommitRow } from './CommitRow'

type HistoryTabProps = {
    api: ApiClient
    sessionId: string
    ahead: number
    currentBranch: string | null
    onRefresh: () => void
}

export function HistoryTab({ api, sessionId, ahead, currentBranch, onRefresh }: HistoryTabProps) {
    const { t } = useTranslation()
    const [allCommits, setAllCommits] = useState<CommitEntry[]>([])
    const [skip, setSkip] = useState(0)
    const [hasMore, setHasMore] = useState(true)
    const [selectedBranch, setSelectedBranch] = useState<string | undefined>(undefined)
    const { local: localBranches, remote: remoteBranches } = useGitBranches(api, sessionId, currentBranch)
    const { commits, isLoading } = useGitLog(api, sessionId, { limit: 50, skip, branch: selectedBranch })
    const scrollRef = useRef<HTMLDivElement>(null)
    const [uncommitTarget, setUncommitTarget] = useState<CommitEntry | null>(null)
    const [uncommitLoading, setUncommitLoading] = useState(false)

    // Cherry-pick
    const [cherryPickTarget, setCherryPickTarget] = useState<CommitEntry | null>(null)
    const [cherryPickLoading, setCherryPickLoading] = useState(false)

    // Reset mixed
    const [resetMixedTarget, setResetMixedTarget] = useState<CommitEntry | null>(null)
    const [resetMixedLoading, setResetMixedLoading] = useState(false)

    // Reset hard
    const [resetHardTarget, setResetHardTarget] = useState<CommitEntry | null>(null)
    const [resetHardLoading, setResetHardLoading] = useState(false)
    const [resetHardInput, setResetHardInput] = useState('')

    // Create tag
    const [createTagTarget, setCreateTagTarget] = useState<CommitEntry | null>(null)
    const [tagName, setTagName] = useState('')
    const [tagMessage, setTagMessage] = useState('')
    const [createTagLoading, setCreateTagLoading] = useState(false)

    // Tags view
    const [viewMode, setViewMode] = useState<'commits' | 'tags'>('commits')
    const { tags, isLoading: tagsLoading, refetch: refetchTags } = useGitTags(api, sessionId)
    const [deleteTagTarget, setDeleteTagTarget] = useState<string | null>(null)
    const [deleteTagLoading, setDeleteTagLoading] = useState(false)

    const handleBranchChange = useCallback((branch: string) => {
        const value = branch === '' ? undefined : branch
        setSelectedBranch(value)
        setAllCommits([])
        setSkip(0)
        setHasMore(true)
    }, [])

    useEffect(() => {
        if (commits.length > 0) {
            setAllCommits(prev => skip === 0 ? commits : [...prev, ...commits])
            setHasMore(commits.length === 50)
        } else if (!isLoading) {
            setHasMore(false)
        }
    }, [commits, skip, isLoading])

    const handleScroll = useCallback(() => {
        const el = scrollRef.current
        if (!el || isLoading || !hasMore) return
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
            setSkip(allCommits.length)
        }
    }, [isLoading, hasMore, allCommits.length])

    const handleUncommit = useCallback(async () => {
        if (!uncommitTarget) return
        setUncommitLoading(true)
        const res = await api.gitReset(sessionId, `${uncommitTarget.hash}~1`, 'soft')
        setUncommitLoading(false)
        if (res.success) {
            setUncommitTarget(null)
            notify.success(t('notify.git.uncommitOk'))
            setSkip(0)
            setAllCommits([])
            onRefresh()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Uncommit failed')
        }
    }, [api, sessionId, uncommitTarget, t, onRefresh])

    const handleCherryPick = useCallback(async () => {
        if (!cherryPickTarget) return
        setCherryPickLoading(true)
        const res = await api.gitCherryPick(sessionId, cherryPickTarget.hash)
        setCherryPickLoading(false)
        if (res.success) {
            setCherryPickTarget(null)
            notify.success(t('notify.git.cherryPickOk'))
            setSkip(0); setAllCommits([]); onRefresh()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Cherry-pick failed')
        }
    }, [api, sessionId, cherryPickTarget, t, onRefresh])

    const handleResetMixed = useCallback(async () => {
        if (!resetMixedTarget) return
        setResetMixedLoading(true)
        const res = await api.gitReset(sessionId, resetMixedTarget.hash, 'mixed')
        setResetMixedLoading(false)
        if (res.success) {
            setResetMixedTarget(null)
            notify.success(t('notify.git.resetOk'))
            setSkip(0); setAllCommits([]); onRefresh()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Reset failed')
        }
    }, [api, sessionId, resetMixedTarget, t, onRefresh])

    const handleResetHard = useCallback(async () => {
        if (!resetHardTarget || resetHardInput !== 'RESET') return
        setResetHardLoading(true)
        const res = await api.gitReset(sessionId, resetHardTarget.hash, 'hard')
        setResetHardLoading(false)
        if (res.success) {
            setResetHardTarget(null); setResetHardInput('')
            notify.success(t('notify.git.resetOk'))
            setSkip(0); setAllCommits([]); onRefresh()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Reset failed')
        }
    }, [api, sessionId, resetHardTarget, resetHardInput, t, onRefresh])

    const handleCreateTag = useCallback(async () => {
        if (!createTagTarget || !tagName.trim()) return
        setCreateTagLoading(true)
        const res = await api.gitTagCreate(sessionId, tagName.trim(), tagMessage.trim() || undefined, createTagTarget.hash)
        setCreateTagLoading(false)
        if (res.success) {
            setCreateTagTarget(null); setTagName(''); setTagMessage('')
            notify.success(t('notify.git.tagCreateOk'))
            refetchTags()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Tag creation failed')
        }
    }, [api, sessionId, createTagTarget, tagName, tagMessage, t])

    const handleDeleteTag = useCallback(async () => {
        if (!deleteTagTarget) return
        setDeleteTagLoading(true)
        const res = await api.gitTagDelete(sessionId, deleteTagTarget)
        setDeleteTagLoading(false)
        if (res.success) {
            setDeleteTagTarget(null)
            notify.success(t('notify.git.tagDeleteOk'))
            refetchTags()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Delete tag failed')
        }
    }, [api, sessionId, deleteTagTarget, t, refetchTags])

    return (
        <div className="flex flex-col h-full">
            {/* Tab switcher */}
            <div className="flex border-b border-[var(--app-divider)] shrink-0">
                <button
                    type="button"
                    onClick={() => setViewMode('commits')}
                    className={`flex-1 py-2 text-xs font-medium transition-colors ${viewMode === 'commits' ? 'text-[var(--app-link)] border-b-2 border-[var(--app-link)]' : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'}`}
                >
                    Commits
                </button>
                <button
                    type="button"
                    onClick={() => setViewMode('tags')}
                    className={`flex-1 py-2 text-xs font-medium transition-colors ${viewMode === 'tags' ? 'text-[var(--app-link)] border-b-2 border-[var(--app-link)]' : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'}`}
                >
                    {t('git.tags', { n: tags.length })}
                </button>
            </div>
            {/* Branch selector */}
            {viewMode === 'commits' && (localBranches.length > 0 || remoteBranches.length > 0) && (
                <div className="px-3 py-2 border-b border-[var(--app-divider)] shrink-0">
                    <select
                        value={selectedBranch ?? ''}
                        onChange={e => handleBranchChange(e.target.value)}
                        className="w-full text-xs px-2 py-1.5 rounded border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] truncate"
                    >
                        <option value="">{currentBranch ? `${currentBranch} (HEAD)` : 'HEAD'}</option>
                        {localBranches.length > 0 && (
                            <optgroup label={t('git.localBranches', { n: localBranches.length })}>
                                {localBranches.filter(b => b.name !== currentBranch).map(b => (
                                    <option key={b.name} value={b.name}>{b.name}</option>
                                ))}
                            </optgroup>
                        )}
                        {remoteBranches.length > 0 && (
                            <optgroup label={t('git.remoteBranches', { n: remoteBranches.length })}>
                                {remoteBranches.map(b => (
                                    <option key={b.name} value={b.name}>{b.name}</option>
                                ))}
                            </optgroup>
                        )}
                    </select>
                </div>
            )}
            {viewMode === 'commits' && (
                <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
                    {allCommits.map((commit, index) => (
                        <CommitRow
                            key={commit.hash}
                            commit={commit}
                            api={api}
                            sessionId={sessionId}
                            isLocal={!selectedBranch && index < ahead}
                            onUncommit={selectedBranch ? undefined : () => setUncommitTarget(commit)}
                            onCherryPick={() => setCherryPickTarget(commit)}
                            onResetMixed={selectedBranch ? undefined : () => setResetMixedTarget(commit)}
                            onResetHard={selectedBranch ? undefined : () => setResetHardTarget(commit)}
                            onCreateTag={() => setCreateTagTarget(commit)}
                        />
                    ))}
                    {isLoading && (
                        <div className="flex justify-center py-4">
                            <span className="w-5 h-5 border-2 border-[var(--app-link)] border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                    {!hasMore && allCommits.length > 0 && (
                        <div className="text-center text-xs text-[var(--app-hint)] py-4">{t('git.noMoreCommits')}</div>
                    )}
                    {!isLoading && allCommits.length === 0 && (
                        <div className="text-center text-sm text-[var(--app-hint)] py-8">{t('git.noCommitHistory')}</div>
                    )}
                </div>
            )}
            {viewMode === 'tags' && (
                <div className="flex-1 overflow-y-auto">
                    {tagsLoading ? (
                        <div className="flex justify-center py-4">
                            <span className="w-5 h-5 border-2 border-[var(--app-link)] border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : tags.length === 0 ? (
                        <div className="text-center text-sm text-[var(--app-hint)] py-8">{t('git.noTags')}</div>
                    ) : (
                        tags.map(tag => (
                            <div key={tag.name} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--app-divider)] last:border-0">
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm text-[var(--app-fg)] font-medium truncate">{tag.name}</div>
                                    <div className="text-xs text-[var(--app-hint)] mt-0.5 flex items-center gap-1">
                                        <span className="font-mono">{tag.short}</span>
                                        {tag.subject && <><span>·</span><span className="truncate">{tag.subject}</span></>}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setDeleteTagTarget(tag.name)}
                                    className="shrink-0 text-xs text-red-500 hover:bg-[var(--app-subtle-bg)] px-2 py-1 rounded transition-colors"
                                >
                                    {t('git.deleteTag')}
                                </button>
                            </div>
                        ))
                    )}
                </div>
            )}
            <ConfirmDialog
                isOpen={uncommitTarget !== null}
                onClose={() => setUncommitTarget(null)}
                title={t('dialog.git.uncommit.title')}
                description={t('dialog.git.uncommit.description', { subject: uncommitTarget?.subject ?? '' })}
                confirmLabel={t('dialog.git.uncommit.confirm')}
                confirmingLabel={t('dialog.git.uncommit.confirming')}
                onConfirm={handleUncommit}
                isPending={uncommitLoading}
                destructive
            />
            {/* Cherry-pick confirm */}
            <ConfirmDialog
                isOpen={cherryPickTarget !== null}
                onClose={() => setCherryPickTarget(null)}
                title={t('dialog.git.cherryPick.title')}
                description={t('dialog.git.cherryPick.description', { short: cherryPickTarget?.short ?? '', subject: cherryPickTarget?.subject ?? '' })}
                confirmLabel={t('dialog.git.cherryPick.confirm')}
                confirmingLabel={t('dialog.git.cherryPick.confirming')}
                onConfirm={handleCherryPick}
                isPending={cherryPickLoading}
            />
            {/* Reset mixed confirm */}
            <ConfirmDialog
                isOpen={resetMixedTarget !== null}
                onClose={() => setResetMixedTarget(null)}
                title={t('dialog.git.resetMixed.title')}
                description={t('dialog.git.resetMixed.description', { short: resetMixedTarget?.short ?? '' })}
                confirmLabel={t('dialog.git.resetMixed.confirm')}
                confirmingLabel={t('dialog.git.resetMixed.confirming')}
                onConfirm={handleResetMixed}
                isPending={resetMixedLoading}
                destructive
            />
            {/* Hard reset - 需要输入 RESET 确认 */}
            {resetHardTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setResetHardTarget(null); setResetHardInput('') }}>
                    <div className="bg-[var(--app-bg)] rounded-xl border border-[var(--app-border)] p-6 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-base font-semibold text-[var(--app-fg)] mb-2">{t('dialog.git.resetHard.title')}</h3>
                        <p className="text-sm text-[var(--app-hint)] mb-4">{t('dialog.git.resetHard.description', { short: resetHardTarget.short })}</p>
                        <input
                            type="text"
                            value={resetHardInput}
                            onChange={e => setResetHardInput(e.target.value)}
                            placeholder={t('dialog.git.resetHard.inputPlaceholder')}
                            autoFocus
                            className="w-full text-sm px-3 py-2 rounded border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-red-500 mb-4"
                        />
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => { setResetHardTarget(null); setResetHardInput('') }} className="px-4 py-2 text-sm rounded border border-[var(--app-border)] text-[var(--app-hint)]">{t('button.cancel')}</button>
                            <button type="button" onClick={handleResetHard} disabled={resetHardInput !== 'RESET' || resetHardLoading} className="px-4 py-2 text-sm rounded bg-red-500 text-white disabled:opacity-50">{resetHardLoading ? t('dialog.git.resetHard.confirming') : t('dialog.git.resetHard.confirm')}</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Create tag dialog */}
            {createTagTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setCreateTagTarget(null); setTagName(''); setTagMessage('') }}>
                    <div className="bg-[var(--app-bg)] rounded-xl border border-[var(--app-border)] p-6 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-base font-semibold text-[var(--app-fg)] mb-2">{t('dialog.git.createTag.title')}</h3>
                        <p className="text-xs text-[var(--app-hint)] mb-3 font-mono">{createTagTarget.short}: {createTagTarget.subject}</p>
                        <input type="text" value={tagName} onChange={e => setTagName(e.target.value)} placeholder={t('git.tagName')} autoFocus className="w-full text-sm px-3 py-2 rounded border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)] mb-2" />
                        <input type="text" value={tagMessage} onChange={e => setTagMessage(e.target.value)} placeholder={t('git.tagMessage')} className="w-full text-sm px-3 py-2 rounded border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)] mb-4" />
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => { setCreateTagTarget(null); setTagName(''); setTagMessage('') }} className="px-4 py-2 text-sm rounded border border-[var(--app-border)] text-[var(--app-hint)]">{t('button.cancel')}</button>
                            <button type="button" onClick={handleCreateTag} disabled={!tagName.trim() || createTagLoading} className="px-4 py-2 text-sm rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50">{createTagLoading ? t('dialog.git.deleteTag.confirming') : t('git.createTag')}</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Delete tag confirm */}
            <ConfirmDialog
                isOpen={deleteTagTarget !== null}
                onClose={() => setDeleteTagTarget(null)}
                title={t('dialog.git.deleteTag.title')}
                description={t('dialog.git.deleteTag.description', { name: deleteTagTarget ?? '' })}
                confirmLabel={t('dialog.git.deleteTag.confirm')}
                confirmingLabel={t('dialog.git.deleteTag.confirming')}
                onConfirm={handleDeleteTag}
                isPending={deleteTagLoading}
                destructive
            />
        </div>
    )
}
