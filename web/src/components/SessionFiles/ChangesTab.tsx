import { useState, useCallback } from 'react'
import type { ApiClient } from '@/api/client'
import type { GitStatusFiles, GitFileStatus } from '@/types/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
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
    const [gitActionError, setGitActionError] = useState<string | null>(null)
    const [commitLoading, setCommitLoading] = useState(false)
    const [stashOpen, setStashOpen] = useState(false)
    const [stagedExpanded, setStagedExpanded] = useState(true)
    const [unstagedExpanded, setUnstagedExpanded] = useState(true)
    const [confirmAction, setConfirmAction] = useState<'fetch' | 'pull' | 'push' | 'commit' | null>(null)

    const staged = gitStatus?.stagedFiles ?? []
    const unstaged = gitStatus?.unstagedFiles ?? []

    const runGitAction = useCallback(async (action: 'fetch' | 'pull' | 'push', fn: () => Promise<{ success: boolean; error?: string; stderr?: string }>) => {
        setGitActionLoading(action)
        setGitActionError(null)
        const res = await fn()
        setGitActionLoading(null)
        if (!res.success) {
            const msg = res.stderr ?? res.error ?? `${action} failed`
            setGitActionError(msg)
            throw new Error(msg)
        }
        setConfirmAction(null)
        onRefresh()
    }, [onRefresh])

    const handleStage = useCallback(async (file: GitFileStatus) => {
        const res = await api.gitStage(sessionId, file.fullPath, !file.isStaged)
        if (res.success) onRefresh()
    }, [api, sessionId, onRefresh])

    const handleStageAll = useCallback(async () => {
        for (const f of unstaged) {
            await api.gitStage(sessionId, f.fullPath, true)
        }
        onRefresh()
    }, [api, sessionId, unstaged, onRefresh])

    const handleUnstageAll = useCallback(async () => {
        for (const f of staged) {
            await api.gitStage(sessionId, f.fullPath, false)
        }
        onRefresh()
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
        } else {
            const msg = res.stderr ?? res.error ?? 'Commit failed'
            setGitActionError(msg)
            throw new Error(msg)
        }
    }, [api, sessionId, commitMessage, staged.length, onRefresh])

    const handleRollback = useCallback(async (path: string) => {
        const res = await api.gitRollbackFile(sessionId, path)
        if (res.success) onRefresh()
    }, [api, sessionId, onRefresh])

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
                error={gitActionError}
                onDismissError={() => setGitActionError(null)}
            />
            <div className="flex-1 overflow-y-auto">
                {/* Staged section */}
                <button type="button" onClick={() => setStagedExpanded(!stagedExpanded)} className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]">
                    <span>{stagedExpanded ? '▼' : '▶'}</span>
                    <span>Staged Changes ({staged.length})</span>
                </button>
                {stagedExpanded && staged.map((file, i) => (
                    <GitFileRow key={file.fullPath} file={file} onOpen={onOpenFile} showCheckbox checked onToggle={handleStage} showDivider={i < staged.length - 1} />
                ))}
                {/* Unstaged section */}
                <button type="button" onClick={() => setUnstagedExpanded(!unstagedExpanded)} className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] border-t border-[var(--app-divider)]">
                    <span>{unstagedExpanded ? '▼' : '▶'}</span>
                    <span>Unstaged Changes ({unstaged.length})</span>
                </button>
                {unstagedExpanded && unstaged.map((file, i) => (
                    <GitFileRow key={file.fullPath} file={file} onOpen={onOpenFile} onRollback={handleRollback} showCheckbox checked={false} onToggle={handleStage} showDivider={i < unstaged.length - 1} />
                ))}
            </div>
            {/* Fixed bottom: actions + commit */}
            <div className="border-t border-[var(--app-divider)] bg-[var(--app-bg)] p-3 flex flex-col gap-2">
                <div className="flex gap-2">
                    <button type="button" onClick={handleStageAll} disabled={unstaged.length === 0} className="flex-1 text-xs py-1.5 rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40">Stage All</button>
                    <button type="button" onClick={handleUnstageAll} disabled={staged.length === 0} className="flex-1 text-xs py-1.5 rounded border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40">Unstage All</button>
                </div>
                <textarea
                    value={commitMessage}
                    onChange={e => setCommitMessage(e.target.value)}
                    placeholder="Commit message..."
                    className="text-xs border border-[var(--app-border)] rounded p-1.5 resize-none h-16 bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:border-[var(--app-link)]"
                />
                <button
                    type="button"
                    onClick={() => setConfirmAction('commit')}
                    disabled={commitLoading || !commitMessage.trim() || staged.length === 0}
                    className="text-xs px-3 py-1.5 rounded bg-[var(--app-link)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                    {commitLoading ? 'Committing...' : `Commit${staged.length > 0 ? ` (${staged.length})` : ''}`}
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
        </div>
    )
}
