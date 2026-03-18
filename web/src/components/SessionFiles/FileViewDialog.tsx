import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GitCommandResponse } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { queryKeys } from '@/lib/query-keys'
import { langAlias, useShikiHighlighter } from '@/lib/shiki'
import { decodeBase64 } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

const MAX_COPYABLE_FILE_BYTES = 1_000_000

function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length
}

function isBinaryContent(content: string): boolean {
    if (!content) return false
    if (content.includes('\0')) return true
    const nonPrintable = content.split('').filter((char) => {
        const code = char.charCodeAt(0)
        return code < 32 && code !== 9 && code !== 10 && code !== 13
    }).length
    return nonPrintable / content.length > 0.1
}

function extractCommandError(result: GitCommandResponse | undefined): string | null {
    if (!result) return null
    if (result.success) return null
    return result.error ?? result.stderr ?? null
}

function resolveLanguage(path: string): string | undefined {
    const parts = path.split('.')
    if (parts.length <= 1) return undefined
    const ext = parts[parts.length - 1]?.toLowerCase()
    if (!ext) return undefined
    return langAlias[ext] ?? ext
}

export function DiffDisplay(props: { diffContent: string }) {
    const lines = props.diffContent.split('\n')
    return (
        <div className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
            {lines.map((line, index) => {
                const isAdd = line.startsWith('+') && !line.startsWith('+++')
                const isRemove = line.startsWith('-') && !line.startsWith('---')
                const isHunk = line.startsWith('@@')
                const isHeader = line.startsWith('+++') || line.startsWith('---')
                const className = [
                    'whitespace-pre-wrap px-3 py-0.5 text-xs font-mono',
                    isAdd ? 'bg-[var(--app-diff-added-bg)] text-[var(--app-diff-added-text)]' : '',
                    isRemove ? 'bg-[var(--app-diff-removed-bg)] text-[var(--app-diff-removed-text)]' : '',
                    isHunk ? 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] font-semibold' : '',
                    isHeader ? 'text-[var(--app-hint)] font-semibold' : ''
                ].filter(Boolean).join(' ')
                const style = isAdd
                    ? { borderLeft: '2px solid var(--app-git-staged-color)' }
                    : isRemove
                        ? { borderLeft: '2px solid var(--app-git-deleted-color)' }
                        : undefined
                return (
                    <div key={`${index}-${line}`} className={className} style={style}>
                        {line || ' '}
                    </div>
                )
            })}
        </div>
    )
}

function FileContentSkeleton() {
    const widths = ['w-full', 'w-11/12', 'w-5/6', 'w-3/4', 'w-2/3', 'w-4/5']
    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">Loading file…</span>
            <div className="animate-pulse space-y-2 rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-3">
                {Array.from({ length: 12 }).map((_, index) => (
                    <div key={`file-skeleton-${index}`} className={`h-3 ${widths[index % widths.length]} rounded bg-[var(--app-subtle-bg)]`} />
                ))}
            </div>
        </div>
    )
}

type FileViewContentProps = {
    api: ApiClient
    sessionId: string
    filePath: string
    /** If set, shows diff + file content for this commit */
    commitHash?: string
    /** If true, shows staged diff (only for non-commit mode) */
    staged?: boolean
}

export function FileViewContent({ api, sessionId, filePath, commitHash, staged }: FileViewContentProps) {
    const { t } = useTranslation()
    const { copied: pathCopied, copy: copyPath } = useCopyToClipboard()
    const { copied: contentCopied, copy: copyContent } = useCopyToClipboard()
    const fileName = filePath.split('/').pop() || filePath || 'File'

    const diffQuery = useQuery({
        queryKey: commitHash
            ? ['gitShowFile', sessionId, commitHash, filePath]
            : queryKeys.gitFileDiff(sessionId, filePath, staged),
        queryFn: async () => {
            if (commitHash) return await api.gitShowFile(sessionId, commitHash, filePath)
            return await api.getGitDiffFile(sessionId, filePath, staged)
        },
        enabled: Boolean(sessionId && filePath)
    })

    const fileQuery = useQuery({
        queryKey: queryKeys.sessionFile(sessionId, filePath),
        queryFn: async () => await api.readSessionFile(sessionId, filePath),
        enabled: Boolean(sessionId && filePath && !commitHash)
    })

    const commitFileQuery = useQuery({
        queryKey: ['gitShowFileContent', sessionId, commitHash, filePath],
        queryFn: async () => await api.gitShowFileContent(sessionId, commitHash!, filePath),
        enabled: Boolean(sessionId && filePath && commitHash)
    })

    const diffContent = diffQuery.data?.success ? (diffQuery.data.stdout ?? '') : ''
    const diffError = extractCommandError(diffQuery.data)
    const diffSuccess = diffQuery.data?.success === true
    const diffFailed = diffQuery.data?.success === false

    const fileContentResult = fileQuery.data
    const decodedContentResult = fileContentResult?.success && fileContentResult.content
        ? decodeBase64(fileContentResult.content)
        : { text: '', ok: true }
    const commitFileContent = commitHash && commitFileQuery.data?.success ? (commitFileQuery.data.stdout ?? '') : ''
    const decodedContent = commitHash ? commitFileContent : decodedContentResult.text
    const binaryFile = commitHash
        ? isBinaryContent(commitFileContent)
        : (fileContentResult?.success ? !decodedContentResult.ok || isBinaryContent(decodedContentResult.text) : false)

    const language = useMemo(() => resolveLanguage(filePath), [filePath])
    const highlighted = useShikiHighlighter(decodedContent, language)
    const contentSizeBytes = useMemo(() => (decodedContent ? getUtf8ByteLength(decodedContent) : 0), [decodedContent])
    const canCopyContent = !binaryFile && decodedContent.length > 0 && contentSizeBytes <= MAX_COPYABLE_FILE_BYTES

    const [displayMode, setDisplayMode] = useState<'diff' | 'file'>('diff')

    useEffect(() => {
        if (commitHash) { setDisplayMode('diff'); return }
        if (diffSuccess && !diffContent) { setDisplayMode('file'); return }
        if (diffFailed) { setDisplayMode('file') }
    }, [commitHash, diffSuccess, diffFailed, diffContent])

    const loading = diffQuery.isLoading || fileQuery.isLoading || commitFileQuery.isLoading

    // Derive effective display mode: if no diff content and not in commit mode, show file
    const effectiveMode = commitHash
        ? displayMode
        : (!diffContent && !diffQuery.isLoading) ? 'file' : displayMode
    const fileError = fileContentResult && !fileContentResult.success
        ? (fileContentResult.error ?? t('git.fileLoadFailed')) : null
    const diffErrorMessage = diffError ? t('git.diffUnavailable', { error: diffError }) : null

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* File path bar */}
            <div className="shrink-0 px-3 py-2 flex items-center gap-2 border-b border-[var(--app-divider)]">
                <FileIcon fileName={fileName} size={16} />
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-hint)] font-mono">{filePath}</span>
                <button
                    type="button"
                    onClick={() => copyPath(filePath)}
                    className="shrink-0 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                    title={t('git.copyPath')}
                >
                    {pathCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                </button>
            </div>

            {/* Diff/File toggle */}
            {diffContent ? (
                <div className="shrink-0 px-3 py-2 flex items-center gap-2 border-b border-[var(--app-divider)]">
                    <button type="button" onClick={() => setDisplayMode('diff')}
                        className={`rounded px-3 py-1 text-xs font-semibold ${effectiveMode === 'diff' ? 'bg-[var(--app-button)] text-[var(--app-button-text)] opacity-80' : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'}`}>
                        {t('git.diff')}
                    </button>
                    <button type="button" onClick={() => setDisplayMode('file')}
                        className={`rounded px-3 py-1 text-xs font-semibold ${effectiveMode === 'file' ? 'bg-[var(--app-button)] text-[var(--app-button-text)] opacity-80' : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'}`}>
                        {t('git.file')}
                    </button>
                </div>
            ) : null}

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                {diffErrorMessage ? (
                    <div className="mb-3 rounded-md bg-amber-500/10 p-2 text-xs text-[var(--app-hint)]">{diffErrorMessage}</div>
                ) : null}
                {!filePath ? (
                    <div className="text-sm text-[var(--app-hint)]">{t('git.noFilePath')}</div>
                ) : loading ? (
                    <FileContentSkeleton />
                ) : fileError ? (
                    <div className="text-sm text-[var(--app-hint)]">{fileError}</div>
                ) : binaryFile ? (
                    <div className="text-sm text-[var(--app-hint)]">{t('git.binaryFile')}</div>
                ) : effectiveMode === 'diff' && diffContent ? (
                    <DiffDisplay diffContent={diffContent} />
                ) : effectiveMode === 'diff' && diffError ? (
                    <div className="text-sm text-[var(--app-hint)]">{diffError}</div>
                ) : effectiveMode === 'file' ? (
                    decodedContent ? (
                        <div className="relative">
                            {canCopyContent ? (
                                <button type="button" onClick={() => copyContent(decodedContent)}
                                    className="absolute right-2 top-2 z-10 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                                    title={t('git.copyContent')}>
                                    {contentCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                                </button>
                            ) : null}
                            <pre className="shiki overflow-auto rounded-md bg-[var(--app-code-bg)] p-3 pr-8 text-xs font-mono">
                                <code>{highlighted ?? decodedContent}</code>
                            </pre>
                        </div>
                    ) : (
                        <div className="text-sm text-[var(--app-hint)]">{t('git.fileEmpty')}</div>
                    )
                ) : (
                    <div className="text-sm text-[var(--app-hint)]">{t('git.noChanges')}</div>
                )}
            </div>
        </div>
    )
}

type FileViewDialogProps = {
    api: ApiClient
    sessionId: string
    filePath: string
    commitHash?: string
    staged?: boolean
    onClose: () => void
}

export function FileViewDialog({ api, sessionId, filePath, commitHash, staged, onClose }: FileViewDialogProps) {
    const fileName = filePath.split('/').pop() || filePath || 'File'

    // Close on Escape
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose])

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 animate-backdrop-fade" onClick={onClose} />

            {/* Panel — centered dialog */}
            <div className="relative flex flex-col bg-[var(--app-bg)] rounded-xl w-full max-w-2xl max-h-[88dvh] shadow-xl animate-fade-in-scale">
                {/* Header */}
                <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--app-border)]">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                        aria-label="Close"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{fileName}</div>
                        {commitHash && <div className="truncate text-xs text-[var(--app-hint)] font-mono">{commitHash.slice(0, 8)}</div>}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                    <FileViewContent
                        api={api}
                        sessionId={sessionId}
                        filePath={filePath}
                        commitHash={commitHash}
                        staged={staged}
                    />
                </div>
            </div>
        </div>
    )
}
