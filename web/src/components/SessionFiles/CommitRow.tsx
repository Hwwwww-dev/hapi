import { useState, useRef, useEffect } from 'react'
import type { ApiClient } from '@/api/client'
import type { CommitEntry } from '@/types/api'
import { FileViewDialog } from './FileViewDialog'
import { notify } from '@/lib/notify'
import { useTranslation } from '@/lib/use-translation'

function formatRelativeTime(timestamp: number, t: (key: string, params?: Record<string, unknown>) => string): string {
    const now = Date.now() / 1000
    const diff = now - timestamp
    if (diff < 60) return t('git.justNow')
    if (diff < 3600) return t('git.minutesAgo', { n: Math.floor(diff / 60) })
    if (diff < 86400) return t('git.hoursAgo', { n: Math.floor(diff / 3600) })
    if (diff < 604800) return t('git.daysAgo', { n: Math.floor(diff / 86400) })
    return new Date(timestamp * 1000).toLocaleDateString()
}

type FileEntry = { status: 'A' | 'M' | 'D' | string; path: string }

function parseChangedFiles(output: string): FileEntry[] {
    return output
        .split('\n')
        .map(line => line.replace(/\r$/, '').trim())
        .filter(line => line.length > 0)
        .map(line => {
            const tab = line.indexOf('\t')
            if (tab === -1) {
                // fallback: split on whitespace
                const parts = line.split(/\s+/)
                if (parts.length >= 2) return { status: parts[0], path: parts.slice(1).join(' ') }
                return { status: 'M', path: line }
            }
            return { status: line.slice(0, tab).trim(), path: line.slice(tab + 1).trim() }
        })
}

type CommitRowProps = {
    commit: CommitEntry
    api: ApiClient
    sessionId: string
    isLocal?: boolean
    onUncommit?: () => void
}

function CommitActionMenu({ onUncommit, disabled }: { onUncommit: () => void; disabled?: boolean }) {
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
                <div className="animate-fade-in-scale absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1 shadow-lg">
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={(e) => { e.stopPropagation(); setOpen(false); onUncommit() }}
                        className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${disabled ? 'text-[var(--app-hint)] opacity-40 cursor-not-allowed' : 'text-red-500 hover:bg-[var(--app-subtle-bg)]'}`}
                    >
                        {t('git.uncommit')}
                    </button>
                </div>
            )}
        </div>
    )
}

export function CommitRow({ commit, api, sessionId, isLocal, onUncommit }: CommitRowProps) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    const [files, setFiles] = useState<FileEntry[]>([])
    const [loading, setLoading] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [dialogFile, setDialogFile] = useState<string | null>(null)

    async function handleToggle() {
        if (!expanded && !loaded) {
            setLoading(true)
            try {
                const res = await api.gitShowStat(sessionId, commit.hash)
                if (res.success && res.stdout) {
                    setFiles(parseChangedFiles(res.stdout))
                }
            } finally {
                setLoading(false)
                setLoaded(true)
            }
        }
        setExpanded(prev => !prev)
    }

    return (
        <>
            <div className="relative border-b border-[var(--app-divider)] last:border-0">
                <button
                    type="button"
                    onClick={() => void handleToggle()}
                    className="w-full flex items-start gap-3 py-2 px-4 text-left hover:bg-[var(--app-subtle-bg)] transition-colors"
                >
                    <div className="flex flex-col items-center pt-1.5 shrink-0">
                        <div className="w-2 h-2 rounded-full bg-[var(--app-link)]" />
                        <div className="w-px flex-1 min-h-[16px] bg-[var(--app-border)]" />
                    </div>
                    <div className="flex-1 min-w-0 pb-2">
                        <div className="text-sm text-[var(--app-fg)] truncate flex items-center gap-1.5">
                            {isLocal && <span className="shrink-0 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold leading-none bg-amber-500/15 text-amber-600">{t('git.local')}</span>}
                            {!isLocal && <span className="shrink-0 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold leading-none bg-emerald-500/15 text-emerald-600">{t('git.remote')}</span>}
                            <span className="truncate">{commit.subject}</span>
                        </div>
                        <div className="text-xs text-[var(--app-hint)] mt-0.5 flex items-center gap-1">
                            <span className="font-mono">{commit.short}</span>
                            <span>·</span>
                            <span>{commit.author}</span>
                            <span>·</span>
                            <span>{formatRelativeTime(commit.date, t)}</span>
                        </div>
                    </div>
                    <div className="shrink-0 pt-1.5 text-[var(--app-hint)]">
                        {loading
                            ? <span className="w-3.5 h-3.5 border border-[var(--app-link)] border-t-transparent rounded-full animate-spin inline-block" />
                            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${expanded ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
                        }
                    </div>
                </button>
                {onUncommit && (
                    <div className="absolute right-2 top-2">
                        <CommitActionMenu onUncommit={onUncommit} disabled={!isLocal} />
                    </div>
                )}
                {expanded && loaded && (
                    <div className="pl-9 pr-4 pb-3">
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

