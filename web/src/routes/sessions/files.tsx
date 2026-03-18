import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useDirectoryExpanded } from '@/hooks/useDirectoryExpanded'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'
import { ChangesTab } from '@/components/SessionFiles/ChangesTab'
import { HistoryTab } from '@/components/SessionFiles/HistoryTab'
import { BranchesTab } from '@/components/SessionFiles/BranchesTab'
import { FileViewDialog } from '@/components/SessionFiles/FileViewDialog'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useGitStatusFiles } from '@/hooks/queries/useGitStatusFiles'
import { useSession } from '@/hooks/queries/useSession'

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function RefreshIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
        </svg>
    )
}

function GitBranchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
    )
}

type TabType = 'changes' | 'history' | 'branches' | 'directories'

export default function FilesPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/files' })
    const search = useSearch({ from: '/sessions/$sessionId/files' })
    const { session } = useSession(api, sessionId)
    const { expanded, handleExpandedChange } = useDirectoryExpanded(sessionId)

    const validTabs: TabType[] = ['changes', 'history', 'branches', 'directories']
    const initialTab: TabType = validTabs.includes(search.tab as TabType) ? (search.tab as TabType) : 'changes'
    const [activeTab, setActiveTab] = useState<TabType>(initialTab)

    const { status: gitStatus, isLoading: gitLoading, refetch: refetchGit } = useGitStatusFiles(api, sessionId)

    const rawBranch = gitStatus?.branch ?? ''
    const branchLabel = rawBranch.startsWith('HEAD:')
        ? `detached @ ${rawBranch.slice(5)}`
        : rawBranch || 'detached'
    const rootLabel = useMemo(() => {
        const base = session?.metadata?.path ?? sessionId
        const parts = base.split(/[/\\]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : base
    }, [session?.metadata?.path, sessionId])

    const [dialogFile, setDialogFile] = useState<{ path: string; staged?: boolean } | null>(null)

    const handleOpenFile = useCallback((path: string, staged?: boolean) => {
        setDialogFile({ path, staged })
    }, [])

    const handleTabChange = useCallback((nextTab: TabType) => {
        setActiveTab(nextTab)
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId },
            search: nextTab === 'changes' ? {} : { tab: nextTab },
            replace: true,
        })
    }, [navigate, sessionId])

    const visibleTabs: { key: TabType; label: string }[] = [
        { key: 'changes', label: 'Changes' },
        { key: 'history', label: 'History' },
        { key: 'branches', label: 'Branches' },
        { key: 'directories', label: 'Files' },
    ]

    return (
        <>
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <button type="button" onClick={goBack} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]">
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">Git</div>
                        <div className="flex items-center gap-1.5 text-xs text-[var(--app-hint)]">
                            <GitBranchIcon />
                            <span className="truncate">{branchLabel}</span>
                        </div>
                    </div>
                    <button type="button" onClick={() => void refetchGit()} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]" title="Refresh">
                        <RefreshIcon />
                    </button>
                </div>
            </div>

            {/* Tab Bar */}
            <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)]" role="tablist">
                <div className="mx-auto w-full max-w-content grid grid-cols-4">
                    {visibleTabs.map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.key}
                            onClick={() => handleTabChange(tab.key)}
                            className={`relative py-3 text-center text-sm font-semibold transition-colors hover:bg-[var(--app-subtle-bg)] ${activeTab === tab.key ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}
                        >
                            {tab.label}
                            <span className={`absolute bottom-0 left-1/2 h-0.5 w-10 -translate-x-1/2 rounded-full ${activeTab === tab.key ? 'bg-[var(--app-link)]' : 'bg-transparent'}`} />
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                <div className="mx-auto w-full max-w-content flex-1 overflow-hidden flex flex-col">
                    {activeTab === 'changes' && (
                        <ChangesTab api={api} sessionId={sessionId} gitStatus={gitStatus} isLoading={gitLoading} onOpenFile={handleOpenFile} onRefresh={() => void refetchGit()} />
                    )}
                    {activeTab === 'history' && (
                        <HistoryTab api={api} sessionId={sessionId} />
                    )}
                    {activeTab === 'branches' && (
                        <BranchesTab api={api} sessionId={sessionId} currentBranch={gitStatus?.branch ?? null} onBranchChanged={() => void refetchGit()} />
                    )}
                    {activeTab === 'directories' && (
                        <DirectoryTree api={api} sessionId={sessionId} rootLabel={rootLabel} onOpenFile={(path) => handleOpenFile(path)} expandedPaths={expanded} onExpandedChange={handleExpandedChange} />
                    )}
                </div>
            </div>
        </div>
        {dialogFile && api && (
            <FileViewDialog
                api={api}
                sessionId={sessionId}
                filePath={dialogFile.path}
                staged={dialogFile.staged}
                onClose={() => setDialogFile(null)}
            />
        )}
        </>
    )
}
