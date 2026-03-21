import { useState, useRef, useEffect } from 'react'
import type { ApiClient } from '@/api/client'
import type { CommitEntry } from '@/types/api'
import { FileViewDialog } from './FileViewDialog'
import { SimpleMarkdown } from '@/components/SimpleMarkdown'
import { notify } from '@/lib/notify'
import { useTranslation } from '@/lib/use-translation'
import { Tooltip, Collapse } from '@arco-design/web-react'

function formatRelativeTime(timestamp: number, t: (key: string, params?: Record<string, string | number>) => string): string {
    const now = Date.now() / 1000
    const diff = now - timestamp
    if (diff < 60) return t('git.justNow')
    if (diff < 3600) return t('git.minutesAgo', { n: Math.floor(diff / 60) })
    if (diff < 86400) return t('git.hoursAgo', { n: Math.floor(diff / 3600) })
    if (diff < 604800) return t('git.daysAgo', { n: Math.floor(diff / 86400) })
    return new Date(timestamp * 1000).toLocaleDateString()
}

import type { ShowStatEntry } from '@/types/api'

type CommitRowProps = {
    commit: CommitEntry
    api: ApiClient
    sessionId: string
    isLocal?: boolean
    onUncommit?: () => void
    onCherryPick?: () => void
    onResetMixed?: () => void
    onResetHard?: () => void
    onCreateTag?: () => void
    onBranchCreated?: () => void
}

function CommitActionMenu({
    isLocal,
    onUncommit,
    onCherryPick,
    onResetMixed,
    onResetHard,
    onCreateTag,
    onCreateBranch,
}: {
    isLocal?: boolean
    onUncommit?: () => void
    onCherryPick?: () => void
    onResetMixed?: () => void
    onResetHard?: () => void
    onCreateTag?: () => void
    onCreateBranch?: () => void
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
                <div className="animate-fade-in-scale absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1 shadow-lg">
                    {onCreateBranch && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onCreateBranch() }}
                            className="w-full px-3 py-1.5 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors">
                            {t('git.newBranchFromCommit')}
                        </button>
                    )}
                    {onCherryPick && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onCherryPick() }}
                            className="w-full px-3 py-1.5 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors">
                            {t('git.cherryPick')}
                        </button>
                    )}
                    {onCreateTag && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onCreateTag() }}
                            className="w-full px-3 py-1.5 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors">
                            {t('git.createTag')}
                        </button>
                    )}
                    <div className="my-1 border-t border-[var(--app-divider)]" />
                    {onUncommit && (
                        <button type="button" disabled={!isLocal} onClick={(e) => { e.stopPropagation(); setOpen(false); onUncommit() }}
                            className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${!isLocal ? 'text-[var(--app-hint)] opacity-40 cursor-not-allowed' : 'text-red-500 hover:bg-[var(--app-subtle-bg)]'}`}>
                            {t('git.uncommit')}
                        </button>
                    )}
                    {onResetMixed && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onResetMixed() }}
                            className="w-full px-3 py-1.5 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors">
                            {t('git.resetMixed')}
                        </button>
                    )}
                    {onResetHard && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); onResetHard() }}
                            className="w-full px-3 py-1.5 text-left text-xs text-red-500 hover:bg-[var(--app-subtle-bg)] transition-colors">
                            {t('git.resetHard')}
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}

export function CommitRow({ commit, api, sessionId, isLocal, onUncommit, onCherryPick, onResetMixed, onResetHard, onCreateTag, onBranchCreated }: CommitRowProps) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    const [files, setFiles] = useState<ShowStatEntry[]>([])
    const [loading, setLoading] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [dialogFile, setDialogFile] = useState<string | null>(null)
    const [showBranchForm, setShowBranchForm] = useState(false)
    const [branchName, setBranchName] = useState('')
    const [checkoutAfterCreate, setCheckoutAfterCreate] = useState(true)
    const [branchLoading, setBranchLoading] = useState(false)
    const branchInputRef = useRef<HTMLInputElement>(null)

    async function handleToggle() {
        if (!expanded && !loaded) {
            setLoading(true)
            try {
                const res = await api.gitShowStat(sessionId, commit.hash)
                if (res.success && res.data) {
                    setFiles(res.data)
                }
            } finally {
                setLoading(false)
                setLoaded(true)
            }
        }
        setExpanded(prev => !prev)
    }

    function handleOpenBranchForm() {
        setShowBranchForm(true)
        setBranchName('')
        setTimeout(() => branchInputRef.current?.focus(), 0)
    }

    async function handleCreateBranch() {
        const name = branchName.trim()
        if (!name || branchLoading) return
        setBranchLoading(true)
        try {
            const res = await api.gitCreateBranch(sessionId, name, commit.hash)
            if (!res.success) {
                notify.error(res.stderr ?? res.error ?? t('git.createBranchFailed'))
                return
            }
            if (checkoutAfterCreate) {
                const checkoutRes = await api.gitCheckout(sessionId, name)
                if (!checkoutRes.success) {
                    notify.error(checkoutRes.stderr ?? checkoutRes.error ?? t('git.checkoutFailed'))
                }
            }
            notify.success(checkoutAfterCreate ? t('notify.git.checkoutOk') : t('git.create'))
            setShowBranchForm(false)
            setBranchName('')
            onBranchCreated?.()
        } finally {
            setBranchLoading(false)
        }
    }

    return (
        <>
            <div className="relative">
                <button
                    type="button"
                    onClick={() => void handleToggle()}
                    className="w-full flex items-start gap-2 px-2 py-1.5 pr-8 text-left rounded-md hover:bg-[var(--app-subtle-bg)] transition-colors"
                >
                    <div className="flex-1 min-w-0">
                        <div className="text-sm text-[var(--app-fg)] truncate flex items-center gap-1.5">
                            {isLocal && <span className="shrink-0 inline-flex items-center rounded-md px-1 py-0.5 text-[10px] font-semibold leading-none bg-amber-500/15 text-amber-600">{t('git.local')}</span>}
                            {!isLocal && <span className="shrink-0 inline-flex items-center rounded-md px-1 py-0.5 text-[10px] font-semibold leading-none bg-emerald-500/15 text-emerald-600">{t('git.remote')}</span>}
                            <span className="truncate">{commit.subject}</span>
                            {loading && <span className="shrink-0 w-3.5 h-3.5 border border-[var(--app-link)] border-t-transparent rounded-full animate-spin inline-block" />}
                        </div>
                        <div className="text-xs text-[var(--app-hint)] mt-0.5 flex items-center gap-1">
                            <span className="font-mono">{commit.short}</span>
                            <span>·</span>
                            <span>{commit.author}</span>
                            <span>·</span>
                            <Tooltip content={new Date(commit.date * 1000).toLocaleString()} trigger={['hover', 'click']}>
                                <span>{formatRelativeTime(commit.date, t)}</span>
                            </Tooltip>
                        </div>
                    </div>
                </button>
                <div className="absolute right-0 top-0">
                    <CommitActionMenu
                        isLocal={isLocal}
                        onUncommit={onUncommit}
                        onCherryPick={onCherryPick}
                        onResetMixed={onResetMixed}
                        onResetHard={onResetHard}
                        onCreateTag={onCreateTag}
                        onCreateBranch={handleOpenBranchForm}
                    />
                </div>
                {showBranchForm && (
                    <div className="pr-4 pb-3 pt-1 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                        <input
                            ref={branchInputRef}
                            type="text"
                            placeholder={t('git.branchName')}
                            value={branchName}
                            onChange={e => setBranchName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void handleCreateBranch(); if (e.key === 'Escape') setShowBranchForm(false) }}
                            className="w-full text-xs px-2 py-1.5 rounded-md border border-[var(--app-border)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
                        />
                        <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[var(--app-hint)]">
                            <input
                                type="checkbox"
                                checked={checkoutAfterCreate}
                                onChange={e => setCheckoutAfterCreate(e.target.checked)}
                                className="rounded-md"
                            />
                            {t('git.checkoutAfterCreate')}
                        </label>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => void handleCreateBranch()}
                                disabled={!branchName.trim() || branchLoading}
                                className="flex-1 min-h-[26px] text-xs font-medium rounded-md bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50 transition-opacity"
                            >
                                {branchLoading ? t('git.creating') : t('git.create')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowBranchForm(false)}
                                className="px-3 min-h-[26px] text-xs rounded-md border border-[var(--app-border)] text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                            >
                                {t('button.cancel')}
                            </button>
                        </div>
                    </div>
                )}
                {expanded && loaded && (
                    <div className="pr-4 pb-3">
                        {commit.body && (
                            <Collapse bordered={false} className="commit-body-collapse mb-3 ml-1 rounded-md border border-[var(--app-divider)]">
                                <Collapse.Item name="body" header={<span className="text-xs text-[var(--app-hint)]">{t('git.expandCommitBody')}</span>}>
                                    <div className="text-sm font-medium text-[var(--app-fg)] mb-2">{commit.subject}</div>
                                    <SimpleMarkdown content={commit.body} className="prose prose-sm dark:prose-invert max-w-none break-words text-[var(--app-secondary-fg)]" />
                                </Collapse.Item>
                            </Collapse>
                        )}
                        {files.length === 0
                            ? <div className="text-xs text-[var(--app-hint)]">{t('git.noChangedFiles')}</div>
                            : files.map(f => (
                                <button
                                    key={f.path}
                                    type="button"
                                    onClick={() => setDialogFile(f.path)}
                                    className="flex w-full items-center gap-2 text-left py-0.5 hover:underline"
                                >
                                    <span className={`shrink-0 text-[10px] font-bold w-4 ${f.status === 'A' ? 'text-green-500' : f.status === 'D' ? 'text-red-500' : 'text-yellow-500'}`}>
                                        {f.status === 'A' ? 'A' : f.status === 'D' ? 'D' : 'M'}
                                    </span>
                                    <span className="text-xs text-[var(--app-link)] font-mono truncate">{f.path}</span>
                                    {(f.additions > 0 || f.deletions > 0) && (
                                        <span className="shrink-0 ml-auto flex items-center gap-1 text-[10px] font-mono">
                                            {f.additions > 0 && <span className="text-green-500">+{f.additions}</span>}
                                            {f.deletions > 0 && <span className="text-red-500">-{f.deletions}</span>}
                                        </span>
                                    )}
                                </button>
                            ))
                        }
                    </div>
                )}
            </div>
            {dialogFile && (
                <FileViewDialog
                    api={api}
                    sessionId={sessionId}
                    filePath={dialogFile}
                    commitHash={commit.hash}
                    onClose={() => setDialogFile(null)}
                />
            )}
        </>
    )
}

