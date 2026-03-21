import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Tabs } from '@arco-design/web-react'
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
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { notify } from '@/lib/notify'
import { IconLeft, IconSync, IconBranch } from '@arco-design/web-react/icon'

const TabPane = Tabs.TabPane

type TabType = 'changes' | 'history' | 'branches' | 'directories'

export default function FilesPage() {
    const { t } = useTranslation()
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

    const queryClient = useQueryClient()
    const { status: gitStatus, isLoading: gitLoading } = useGitStatusFiles(api, sessionId)
    const [refreshing, setRefreshing] = useState(false)

    const handleRefreshAll = useCallback(async () => {
        setRefreshing(true)
        try {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.gitStatus(sessionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.gitLog(sessionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.gitBranches(sessionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.gitStashList(sessionId) }),
            ])
            notify.success(t('files.header.refreshed'))
        } finally {
            setRefreshing(false)
        }
    }, [queryClient, sessionId, t])

    const rawBranch = gitStatus?.branch ?? ''
    const branchLabel = rawBranch.startsWith('HEAD:')
        ? `${t('files.header.detached')} @ ${rawBranch.slice(5)}`
        : rawBranch || t('files.header.detached')
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
        { key: 'changes', label: t('files.tab.changes') },
        { key: 'history', label: t('files.tab.history') },
        { key: 'branches', label: t('files.tab.branches') },
        { key: 'directories', label: t('files.tab.files') },
    ]

    return (
        <>
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <button type="button" onClick={goBack} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]">
                        <IconLeft style={{ fontSize: 20 }} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{t('files.header.git')}</div>
                        <div className="flex items-center gap-1.5 text-xs text-[var(--app-hint)]">
                            <IconBranch style={{ fontSize: 16 }} />
                            <span className="truncate">{branchLabel}</span>
                        </div>
                    </div>
                    <button type="button" onClick={() => void handleRefreshAll()} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]" title={t('files.header.refresh')}>
                        <IconSync className={refreshing ? 'animate-spin' : ''} style={{ fontSize: 18 }} />
                    </button>
                </div>
            </div>

            {/* Tab Bar */}
            <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)]">
                <div className="mx-auto w-full max-w-content">
                    <Tabs activeTab={activeTab} onChange={(key) => handleTabChange(key as TabType)} type="line" size="large" className="files-tabs">
                        {visibleTabs.map(tab => (
                            <TabPane key={tab.key} title={tab.label} />
                        ))}
                    </Tabs>
                </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                <div className="mx-auto w-full max-w-content flex-1 overflow-hidden flex flex-col">
                    {activeTab === 'changes' && (
                        <ChangesTab api={api} sessionId={sessionId} gitStatus={gitStatus} isLoading={gitLoading} onOpenFile={handleOpenFile} onRefresh={() => void handleRefreshAll()} />
                    )}
                    {activeTab === 'history' && (
                        <HistoryTab api={api} sessionId={sessionId} ahead={gitStatus?.ahead ?? 0} currentBranch={gitStatus?.branch ?? null} onRefresh={() => void handleRefreshAll()} />
                    )}
                    {activeTab === 'branches' && (
                        <BranchesTab api={api} sessionId={sessionId} currentBranch={gitStatus?.branch ?? null} onBranchChanged={() => void handleRefreshAll()} />
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
