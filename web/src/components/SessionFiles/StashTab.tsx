import { useState, useCallback } from 'react'
import type { ApiClient } from '@/api/client'
import { useGitStashList } from '@/hooks/queries/useGitStashList'
import { useTranslation } from '@/lib/use-translation'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FileViewDialog } from '@/components/SessionFiles/FileViewDialog'
import { notify } from '@/lib/notify'

type StashTabProps = {
    api: ApiClient
    sessionId: string
    onRefresh: () => void
}

type StashFileEntry = { status: string; path: string }

function parseStashFiles(raw: string): StashFileEntry[] {
    if (!raw.trim()) return []
    return raw.trim().split('\n').map(line => {
        const parts = line.split('\t')
        return { status: parts[0] ?? '?', path: parts.slice(1).join('\t') }
    }).filter(e => e.path)
}

const statusLabels: Record<string, { text: string; color: string }> = {
    M: { text: 'M', color: 'text-yellow-500' },
    A: { text: 'A', color: 'text-green-500' },
    D: { text: 'D', color: 'text-red-500' },
    R: { text: 'R', color: 'text-blue-500' },
    C: { text: 'C', color: 'text-purple-500' },
}

export function StashTab({ api, sessionId, onRefresh }: StashTabProps) {
    const { t } = useTranslation()
    const [stashMessage, setStashMessage] = useState('')
    const [actionLoading, setActionLoading] = useState<string | null>(null)
    const [dropTarget, setDropTarget] = useState<number | null>(null)
    const [dialogFile, setDialogFile] = useState<{ path: string; stashRef: string } | null>(null)
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
    const [filesCache, setFilesCache] = useState<Record<number, StashFileEntry[]>>({})
    const [filesLoading, setFilesLoading] = useState<number | null>(null)

    const { stashes, isLoading, refetch } = useGitStashList(api, sessionId)

    const afterAction = useCallback(() => {
        refetch()
        onRefresh()
        setFilesCache({})
        setExpandedIndex(null)
    }, [refetch, onRefresh])

    const handleStash = useCallback(async () => {
        if (!stashMessage.trim()) {
            notify.error(t('git.stashMessageRequired'))
            return
        }
        setActionLoading('stash')
        const res = await api.gitStash(sessionId, stashMessage.trim())
        setActionLoading(null)
        if (res.success) {
            setStashMessage('')
            afterAction()
            notify.success(t('notify.git.stashSaved'))
        } else {
            notify.error(res.stderr ?? res.error ?? t('git.stashFailed'))
        }
    }, [api, sessionId, stashMessage, afterAction, t])

    const toggleFiles = useCallback(async (index: number) => {
        if (expandedIndex === index) {
            setExpandedIndex(null)
            return
        }
        setExpandedIndex(index)
        if (filesCache[index]) return
        setFilesLoading(index)
        try {
            const res = await api.gitStashShow(sessionId, index)
            if (res.success && res.data) {
                setFilesCache(prev => ({ ...prev, [index]: parseStashFiles(res.data!) }))
            }
        } finally {
            setFilesLoading(null)
        }
    }, [api, sessionId, expandedIndex, filesCache])

    const handlePop = useCallback(async (index: number) => {
        setActionLoading(`pop-${index}`)
        const res = await api.gitStashPop(sessionId, index)
        setActionLoading(null)
        if (res.success) {
            afterAction()
            notify.success(t('notify.git.stashPopped'))
        } else {
            notify.error(res.stderr ?? res.error ?? t('git.stashPopFailed'))
        }
    }, [api, sessionId, afterAction, t])

    const handleApply = useCallback(async (index: number) => {
        setActionLoading(`apply-${index}`)
        const res = await api.gitStashApply(sessionId, index)
        setActionLoading(null)
        if (res.success) {
            afterAction()
            notify.success(t('notify.git.stashApplied'))
        } else {
            notify.error(res.stderr ?? res.error ?? t('git.stashApplyFailed'))
        }
    }, [api, sessionId, afterAction, t])

    const handleDrop = useCallback(async () => {
        if (dropTarget === null) return
        setActionLoading(`drop-${dropTarget}`)
        const res = await api.gitStashDrop(sessionId, dropTarget)
        setActionLoading(null)
        setDropTarget(null)
        if (res.success) {
            setFilesCache({})
            setExpandedIndex(null)
            refetch()
            notify.success(t('notify.git.stashDropped'))
        } else {
            notify.error(res.stderr ?? res.error ?? t('git.stashDropFailed'))
        }
    }, [api, sessionId, dropTarget, refetch, t])

    const messageValid = stashMessage.trim().length > 0

    return (
        <div className="flex flex-col h-full">
            {/* Create stash — message required */}
            <div className="px-3 py-2 border-b border-[var(--app-divider)] shrink-0 flex gap-2">
                <input
                    type="text"
                    value={stashMessage}
                    onChange={e => setStashMessage(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && messageValid && handleStash()}
                    placeholder={t('git.stashRequiredMsg')}
                    className={`flex-1 text-xs border rounded-md px-2 py-1.5 bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none transition-colors ${
                        messageValid ? 'border-[var(--app-border)] focus:border-[var(--app-link)]' : 'border-[var(--app-border)] focus:border-[var(--app-link)]'
                    }`}
                />
                <button
                    type="button"
                    onClick={() => void handleStash()}
                    disabled={actionLoading !== null || !messageValid}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-md bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                    {actionLoading === 'stash' ? t('git.stashWorking') : t('git.stashChanges')}
                </button>
            </div>

            {/* Stash list */}
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex justify-center py-4">
                        <span className="w-5 h-5 border-2 border-[var(--app-link)] border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : stashes.length === 0 ? (
                    <div className="text-center text-sm text-[var(--app-hint)] py-8">{t('git.noStashes')}</div>
                ) : (
                    <div>
                        {stashes.map(entry => {
                            const isExpanded = expandedIndex === entry.index
                            const files = filesCache[entry.index]
                            const isFilesLoading = filesLoading === entry.index
                            return (
                                <div key={entry.index} className="border-b border-[var(--app-divider)] last:border-0">
                                    {/* Header row */}
                                    <div className="flex items-center gap-2 px-3 py-2">
                                        <button
                                            type="button"
                                            onClick={() => void toggleFiles(entry.index)}
                                            className="shrink-0 w-5 h-5 flex items-center justify-center text-[10px] text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors"
                                        >
                                            {isExpanded ? '▼' : '▶'}
                                        </button>
                                        <div
                                            className="flex flex-col gap-0.5 min-w-0 flex-1 cursor-pointer"
                                            onClick={() => void toggleFiles(entry.index)}
                                        >
                                            <span className="text-xs font-medium text-[var(--app-fg)] truncate">{entry.message}</span>
                                            <span className="text-[10px] text-[var(--app-hint)] font-mono">stash@{`{${entry.index}}`}</span>
                                        </div>
                                        <div className="flex gap-1 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => void handlePop(entry.index)}
                                                disabled={actionLoading !== null}
                                                className="text-xs px-2 py-1 rounded-md border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40 transition-colors"
                                            >
                                                {actionLoading === `pop-${entry.index}` ? '...' : t('git.stashPop')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleApply(entry.index)}
                                                disabled={actionLoading !== null}
                                                className="text-xs px-2 py-1 rounded-md border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40 transition-colors"
                                            >
                                                {actionLoading === `apply-${entry.index}` ? '...' : t('git.stashApply')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDropTarget(entry.index)}
                                                disabled={actionLoading !== null}
                                                className="text-xs px-2 py-1 rounded-md border border-[var(--app-border)] text-red-500 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                                            >
                                                {t('git.stashDrop')}
                                            </button>
                                        </div>
                                    </div>
                                    {/* Expandable file list */}
                                    {isExpanded && (
                                        <div className="px-3 pb-2 pl-10">
                                            {isFilesLoading ? (
                                                <div className="flex items-center gap-2 py-1">
                                                    <span className="w-3 h-3 border border-[var(--app-link)] border-t-transparent rounded-full animate-spin" />
                                                    <span className="text-[10px] text-[var(--app-hint)]">{t('git.loading')}</span>
                                                </div>
                                            ) : files && files.length > 0 ? (
                                                <div className="flex flex-col gap-0.5">
                                                    <div className="text-[10px] text-[var(--app-hint)] mb-0.5">{t('git.stashFiles', { n: files.length })}</div>
                                                    {files.map((f, i) => {
                                                        const label = statusLabels[f.status] ?? { text: f.status, color: 'text-[var(--app-hint)]' }
                                                        return (
                                                            <button
                                                                key={i}
                                                                type="button"
                                                                onClick={() => setDialogFile({ path: f.path, stashRef: `stash@{${entry.index}}` })}
                                                                className="flex items-center gap-2 text-[11px] w-full text-left rounded-sm px-1 py-0.5 hover:bg-[var(--app-subtle-bg)] transition-colors"
                                                            >
                                                                <span className={`font-mono font-bold w-3 text-center ${label.color}`}>{label.text}</span>
                                                                <span className="text-[var(--app-fg)] truncate font-mono">{f.path}</span>
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="text-[10px] text-[var(--app-hint)]">{t('git.stashNoFiles')}</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Drop confirm */}
            <ConfirmDialog
                isOpen={dropTarget !== null}
                onClose={() => setDropTarget(null)}
                title={t('git.stashDropConfirmTitle')}
                description={t('git.stashDropConfirmDesc', { index: dropTarget ?? 0 })}
                confirmLabel={t('git.stashDrop')}
                confirmingLabel={t('git.stashWorking')}
                onConfirm={handleDrop}
                isPending={actionLoading?.startsWith('drop-') ?? false}
                destructive
            />
            {dialogFile && (
                <FileViewDialog
                    api={api}
                    sessionId={sessionId}
                    filePath={dialogFile.path}
                    commitHash={dialogFile.stashRef}
                    onClose={() => setDialogFile(null)}
                />
            )}
        </div>
    )
}
