import { useState, useCallback, useMemo, useEffect } from 'react'
import type { ApiClient } from '@/api/client'
import type { GitStatusFiles, GitFileStatus } from '@/types/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
import { notify } from '@/lib/notify'
import { GitToolbar } from './GitToolbar'
import { GitFileRow } from './GitFileRow'
import { StashSheet } from './StashSheet'

type ChangesTabProps = {
    api: ApiClient
    sessionId: string
    gitStatus: GitStatusFiles | null
    isLoading: boolean
    onOpenFile: (path: string, staged?: boolean) => void
    onRefresh: () => void
}

export function ChangesTab({ api, sessionId, gitStatus, isLoading, onOpenFile, onRefresh }: ChangesTabProps) {
    const { t } = useTranslation()
    const [commitMessage, setCommitMessage] = useState('')
    const [gitActionLoading, setGitActionLoading] = useState<'fetch' | 'pull' | 'push' | null>(null)
    const [commitLoading, setCommitLoading] = useState(false)
    const [stashOpen, setStashOpen] = useState(false)
    const [stagedExpanded, setStagedExpanded] = useState(true)
    const [unstagedExpanded, setUnstagedExpanded] = useState(true)
    const [confirmAction, setConfirmAction] = useState<'fetch' | 'pull' | 'push' | 'commit' | null>(null)
    // Frontend-only selection state (no API call on toggle)
    const [selectedUnstaged, setSelectedUnstaged] = useState<Set<string>>(new Set())
    const [selectedStaged, setSelectedStaged] = useState<Set<string>>(new Set())
    // Rollback confirmation state
    const [rollbackTarget, setRollbackTarget] = useState<GitFileStatus | null>(null)
    const [rollbackLoading, setRollbackLoading] = useState(false)
    // Batch operation loading
    const [batchLoading, setBatchLoading] = useState(false)

    const staged = gitStatus?.stagedFiles ?? []
    const unstaged = gitStatus?.unstagedFiles ?? []

    // Reset selections when git status changes
    const stagedKey = useMemo(() => staged.map(f => f.fullPath).join(','), [staged])
    const unstagedKey = useMemo(() => unstaged.map(f => f.fullPath).join(','), [unstaged])
    useEffect(() => { setSelectedStaged(new Set()) }, [stagedKey])
    useEffect(() => { setSelectedUnstaged(new Set()) }, [unstagedKey])

    const runGitAction = useCallback(async (action: 'fetch' | 'pull' | 'push', fn: () => Promise<{ success: boolean; error?: string; stderr?: string }>) => {
        setGitActionLoading(action)
        const res = await fn()
        setGitActionLoading(null)
        if (!res.success) {
            const msg = res.stderr ?? res.error ?? `${action} failed`
            notify.error(msg)
            return
        }
        setConfirmAction(null)
        onRefresh()
        const labels: Record<string, string> = { fetch: t('notify.git.fetchOk'), pull: t('notify.git.pullOk'), push: t('notify.git.pushOk') }
        notify.success(labels[action] ?? `${action} completed`)
    }, [onRefresh])

    // Frontend-only toggle for unstaged selection
    const toggleUnstaged = useCallback((file: GitFileStatus) => {
        setSelectedUnstaged(prev => {
            const next = new Set(prev)
            next.has(file.fullPath) ? next.delete(file.fullPath) : next.add(file.fullPath)
            return next
        })
    }, [])

    // Frontend-only toggle for staged selection
    const toggleStaged = useCallback((file: GitFileStatus) => {
        setSelectedStaged(prev => {
            const next = new Set(prev)
            next.has(file.fullPath) ? next.delete(file.fullPath) : next.add(file.fullPath)
            return next
        })
    }, [])

    // Batch stage selected unstaged files
    const handleStageSelected = useCallback(async () => {
        if (selectedUnstaged.size === 0) return
        setBatchLoading(true)
        const files = [...selectedUnstaged].map(fp => ({ filePath: fp, stage: true }))
        const res = await api.gitBatchStage(sessionId, files)
        setBatchLoading(false)
        if (res.success) { setSelectedUnstaged(new Set()); onRefresh() }
    }, [api, sessionId, selectedUnstaged, onRefresh])

    // Batch unstage selected staged files
    const handleUnstageSelected = useCallback(async () => {
        if (selectedStaged.size === 0) return
        setBatchLoading(true)
        const files = [...selectedStaged].map(fp => ({ filePath: fp, stage: false }))
        const res = await api.gitBatchStage(sessionId, files)
        setBatchLoading(false)
        if (res.success) { setSelectedStaged(new Set()); onRefresh() }
    }, [api, sessionId, selectedStaged, onRefresh])

    // Stage all / Unstage all via batch API
    const handleStageAll = useCallback(async () => {
        if (unstaged.length === 0) return
        setBatchLoading(true)
        const files = unstaged.map(f => ({ filePath: f.fullPath, stage: true }))
        const res = await api.gitBatchStage(sessionId, files)
        setBatchLoading(false)
        if (res.success) onRefresh()
    }, [api, sessionId, unstaged, onRefresh])

    const handleUnstageAll = useCallback(async () => {
        if (staged.length === 0) return
        setBatchLoading(true)
        const files = staged.map(f => ({ filePath: f.fullPath, stage: false }))
        const res = await api.gitBatchStage(sessionId, files)
        setBatchLoading(false)
        if (res.success) onRefresh()
    }, [api, sessionId, staged, onRefresh])

    const handleCommit = useCallback(async () => {
        if (!commitMessage.trim() || staged.length === 0) return
        setCommitLoading(true)
        const res = await api.gitCommit(sessionId, commitMessage.trim())
        setCommitLoading(false)
        if (res.success) {
            setCommitMessage('')
            setConfirmAction(null)
            onRefresh()
            notify.success(t('notify.git.commitOk'))
        } else {
            const msg = res.stderr ?? res.error ?? 'Commit failed'
            notify.error(msg)
            return
        }
    }, [api, sessionId, commitMessage, staged.length, onRefresh])

    // Rollback with confirmation - supports both tracked and untracked files
    const requestRollback = useCallback((path: string) => {
        const file = unstaged.find(f => f.fullPath === path)
        if (file) setRollbackTarget(file)
    }, [unstaged])

    const executeRollback = useCallback(async () => {
        if (!rollbackTarget) return
        setRollbackLoading(true)
        let res
        if (rollbackTarget.status === 'untracked') {
            // New file: delete it via git clean
            res = await api.gitCleanFile(sessionId, rollbackTarget.fullPath)
        } else {
            // Tracked file: restore from HEAD
            res = await api.gitRollbackFile(sessionId, rollbackTarget.fullPath)
        }
        setRollbackLoading(false)
        if (res.success) {
            setRollbackTarget(null)
            onRefresh()
            notify.success(t('notify.git.rollbackOk'))
        }
    }, [api, sessionId, rollbackTarget, onRefresh])

    // Select all / deselect all helpers
    const toggleAllUnstaged = useCallback(() => {
        setSelectedUnstaged(prev =>
            prev.size === unstaged.length ? new Set() : new Set(unstaged.map(f => f.fullPath))
        )
    }, [unstaged])

    const toggleAllStaged = useCallback(() => {
        setSelectedStaged(prev =>
            prev.size === staged.length ? new Set() : new Set(staged.map(f => f.fullPath))
        )
    }, [staged])

    if (isLoading && !gitStatus) {
        return <div className="flex justify-center py-8"><span className="w-5 h-5 border-2 border-[var(--app-link)] border-t-transparent rounded-full animate-spin" /></div>
    }

    return (
        <div className="flex flex-col flex-1 overflow-hidden">
            <GitToolbar
                onFetch={() => setConfirmAction('fetch')}
                onPull={() => setConfirmAction('pull')}
                onPush={() => setConfirmAction('push')}
                onStash={() => setStashOpen(true)}
                loading={gitActionLoading}
            />
            <div className="flex-1 overflow-y-auto">
                {/* Staged section */}
                <div className="flex items-center w-full px-3 py-2 text-xs font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]">
                    <button type="button" onClick={() => setStagedExpanded(!stagedExpanded)} className="flex items-center gap-2 flex-1 text-left">
                        <span>{stagedExpanded ? '▼' : '▶'}</span>
                        <span>{t('git.stagedChanges', { n: staged.length })}</span>
                    </button>
                    {stagedExpanded && staged.length > 0 && (
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={toggleAllStaged} className="text-[10px] text-[var(--app-link)] hover:underline">
                                {selectedStaged.size === staged.length ? t('git.deselectAll') : t('git.selectAll')}
                            </button>
                            <button
                                type="button"
                                onClick={handleUnstageSelected}
                                disabled={selectedStaged.size === 0 || batchLoading}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40"
                            >
                                {t('git.unstageN', { n: selectedStaged.size })}
                            </button>
                        </div>
                    )}
                </div>
                {stagedExpanded && staged.map((file, i) => (
                    <GitFileRow key={file.fullPath} file={file} onOpen={onOpenFile} showCheckbox checked={selectedStaged.has(file.fullPath)} onToggle={toggleStaged} showDivider={i < staged.length - 1} />
                ))}
                {/* Unstaged section */}
                <div className="flex items-center w-full px-3 py-2 text-xs font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] border-t border-[var(--app-divider)]">
                    <button type="button" onClick={() => setUnstagedExpanded(!unstagedExpanded)} className="flex items-center gap-2 flex-1 text-left">
                        <span>{unstagedExpanded ? '▼' : '▶'}</span>
                        <span>{t('git.unstagedChanges', { n: unstaged.length })}</span>
                    </button>
                    {unstagedExpanded && unstaged.length > 0 && (
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={toggleAllUnstaged} className="text-[10px] text-[var(--app-link)] hover:underline">
                                {selectedUnstaged.size === unstaged.length ? t('git.deselectAll') : t('git.selectAll')}
                            </button>
                            <button
                                type="button"
                                onClick={handleStageSelected}
                                disabled={selectedUnstaged.size === 0 || batchLoading}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40"
                            >
                                {t('git.stageN', { n: selectedUnstaged.size })}
                            </button>
                        </div>
                    )}
                </div>
                {unstagedExpanded && unstaged.map((file, i) => (
                    <GitFileRow key={file.fullPath} file={file} onOpen={onOpenFile} actions={[{ label: t('dialog.git.rollback.confirm'), onClick: () => requestRollback(file.fullPath), destructive: true }]} showCheckbox checked={selectedUnstaged.has(file.fullPath)} onToggle={toggleUnstaged} showDivider={i < unstaged.length - 1} />
                ))}
            </div>
            {/* Fixed bottom: actions + commit */}
            <div className="border-t border-[var(--app-divider)] bg-[var(--app-bg)] p-3 flex flex-col gap-2">
                <div className="flex gap-2">
                    <button type="button" onClick={handleStageAll} disabled={unstaged.length === 0 || batchLoading} className="flex-1 text-xs py-1.5 rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40">{t('git.stageAll')}</button>
                    <button type="button" onClick={handleUnstageAll} disabled={staged.length === 0 || batchLoading} className="flex-1 text-xs py-1.5 rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40">{t('git.unstageAll')}</button>
                </div>
                <textarea
                    value={commitMessage}
                    onChange={e => setCommitMessage(e.target.value)}
                    placeholder={t('git.commitPlaceholder')}
                    className="text-xs border border-[var(--app-border)] rounded p-1.5 resize-none h-16 bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:border-[var(--app-link)]"
                />
                <button
                    type="button"
                    onClick={() => setConfirmAction('commit')}
                    disabled={commitLoading || !commitMessage.trim() || staged.length === 0}
                    className="text-xs px-3 py-1.5 rounded bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                    {commitLoading ? t('git.committing') : staged.length > 0 ? t('git.commitN', { n: staged.length }) : t('git.commit')}
                </button>
            </div>
            <StashSheet api={api} sessionId={sessionId} open={stashOpen} onClose={() => setStashOpen(false)} onStashChanged={onRefresh} />
            {/* Git action confirm dialogs */}
            <ConfirmDialog
                isOpen={confirmAction === 'fetch'}
                onClose={() => setConfirmAction(null)}
                title={t('dialog.git.fetch.title')}
                description={t('dialog.git.fetch.description')}
                confirmLabel={t('dialog.git.fetch.confirm')}
                confirmingLabel={t('dialog.git.fetch.confirming')}
                onConfirm={async () => { await runGitAction('fetch', () => api.gitFetch(sessionId)) }}
                isPending={gitActionLoading === 'fetch'}
            />
            <ConfirmDialog
                isOpen={confirmAction === 'pull'}
                onClose={() => setConfirmAction(null)}
                title={t('dialog.git.pull.title')}
                description={t('dialog.git.pull.description')}
                confirmLabel={t('dialog.git.pull.confirm')}
                confirmingLabel={t('dialog.git.pull.confirming')}
                onConfirm={async () => { await runGitAction('pull', () => api.gitPull(sessionId)) }}
                isPending={gitActionLoading === 'pull'}
            />
            <ConfirmDialog
                isOpen={confirmAction === 'push'}
                onClose={() => setConfirmAction(null)}
                title={t('dialog.git.push.title')}
                description={t('dialog.git.push.description')}
                confirmLabel={t('dialog.git.push.confirm')}
                confirmingLabel={t('dialog.git.push.confirming')}
                onConfirm={async () => { await runGitAction('push', () => api.gitPush(sessionId)) }}
                isPending={gitActionLoading === 'push'}
            />
            <ConfirmDialog
                isOpen={confirmAction === 'commit'}
                onClose={() => setConfirmAction(null)}
                title={t('dialog.git.commit.title')}
                description={t('dialog.git.commit.description', { n: staged.length })}
                confirmLabel={t('dialog.git.commit.confirm')}
                confirmingLabel={t('dialog.git.commit.confirming')}
                onConfirm={handleCommit}
                isPending={commitLoading}
            />
            {/* Rollback confirm dialog */}
            <ConfirmDialog
                isOpen={rollbackTarget !== null}
                onClose={() => setRollbackTarget(null)}
                title={t('dialog.git.rollback.title')}
                description={rollbackTarget?.status === 'untracked'
                    ? t('dialog.git.rollback.description.untracked', { file: rollbackTarget?.fileName ?? '' })
                    : t('dialog.git.rollback.description', { file: rollbackTarget?.fileName ?? '' })
                }
                confirmLabel={t('dialog.git.rollback.confirm')}
                confirmingLabel={t('dialog.git.rollback.confirming')}
                onConfirm={executeRollback}
                isPending={rollbackLoading}
                destructive
            />
        </div>
    )
}
