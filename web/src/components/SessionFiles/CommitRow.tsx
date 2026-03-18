import { useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { CommitEntry } from '@/types/api'
import { FileViewDialog } from './FileViewDialog'

function formatRelativeTime(timestamp: number): string {
    const now = Date.now() / 1000
    const diff = now - timestamp
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
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
}

export function CommitRow({ commit, api, sessionId }: CommitRowProps) {
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
            <div className="border-b border-[var(--app-divider)] last:border-0">
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
                        <div className="text-sm text-[var(--app-fg)] truncate">{commit.subject}</div>
                        <div className="text-xs text-[var(--app-hint)] mt-0.5 flex items-center gap-1">
                            <span className="font-mono">{commit.short}</span>
                            <span>·</span>
                            <span>{commit.author}</span>
                            <span>·</span>
                            <span>{formatRelativeTime(commit.date)}</span>
                        </div>
                    </div>
                    <div className="shrink-0 pt-1.5 text-[var(--app-hint)]">
                        {loading
                            ? <span className="w-3.5 h-3.5 border border-[var(--app-link)] border-t-transparent rounded-full animate-spin inline-block" />
                            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${expanded ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
                        }
                    </div>
                </button>
                {expanded && loaded && (
                    <div className="pl-9 pr-4 pb-3">
                        {files.length === 0
                            ? <div className="text-xs text-[var(--app-hint)]">No changed files</div>
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

