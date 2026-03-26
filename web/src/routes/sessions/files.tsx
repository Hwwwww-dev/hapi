import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Tabs, Menu } from '@arco-design/web-react'
import { useDirectoryExpanded } from '@/hooks/useDirectoryExpanded'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'
import { ChangesTab } from '@/components/SessionFiles/ChangesTab'
import { CommitsTab } from '@/components/SessionFiles/CommitsTab'
import { TagsTab } from '@/components/SessionFiles/TagsTab'
import { BranchesTab } from '@/components/SessionFiles/BranchesTab'
import { StashTab } from '@/components/SessionFiles/StashTab'
import { FileViewDialog } from '@/components/SessionFiles/FileViewDialog'
import { StashSheet } from '@/components/SessionFiles/StashSheet'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useGitStatusFiles } from '@/hooks/queries/useGitStatusFiles'
import { useSession } from '@/hooks/queries/useSession'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { notify } from '@/lib/notify'
import { IconLeft, IconSync, IconBranch, IconTool, IconArrowDown, IconStorage } from '@arco-design/web-react/icon'

const TabPane = Tabs.TabPane

type TabType = 'changes' | 'commits' | 'tags' | 'branches' | 'stash' | 'directories'

export default function FilesPage() {
    const { t } = useTranslation()
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/vcs' })
    const search = useSearch({ from: '/sessions/$sessionId/vcs' })
    const { session } = useSession(api, sessionId)
    const { expanded, handleExpandedChange } = useDirectoryExpanded(sessionId)

    const validTabs: TabType[] = ['changes', 'commits', 'tags', 'branches', 'stash', 'directories']
    const initialTab: TabType = validTabs.includes(search.tab as TabType) ? (search.tab as TabType) : 'changes'
    const [activeTab, setActiveTab] = useState<TabType>(initialTab)

    const queryClient = useQueryClient()
    const { status: gitStatus, isLoading: gitLoading } = useGitStatusFiles(api, sessionId)
    const [refreshing, setRefreshing] = useState(false)

    // Git action state (fetch / pull / push / stash)
    const [gitActionLoading, setGitActionLoading] = useState<'fetch' | 'pull' | 'push' | null>(null)
    const [confirmAction, setConfirmAction] = useState<'fetch' | 'pull' | 'push' | null>(null)
    const [stashOpen, setStashOpen] = useState(false)
    const [actionsOpen, setActionsOpen] = useState(false)
    const actionsRef = useRef<HTMLDivElement | null>(null)
    const anyActionLoading = gitActionLoading !== null

    useEffect(() => {
        if (!actionsOpen) return

        const onPointerDown = (event: PointerEvent) => {
            if (!actionsRef.current?.contains(event.target as Node)) {
                setActionsOpen(false)
            }
        }

        document.addEventListener('pointerdown', onPointerDown)
        return () => document.removeEventListener('pointerdown', onPointerDown)
    }, [actionsOpen])

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
        void handleRefreshAll()
        const labels: Record<string, string> = { fetch: t('notify.git.fetchOk'), pull: t('notify.git.pullOk'), push: t('notify.git.pushOk') }
        notify.success(labels[action] ?? `${action} completed`)
    }, [handleRefreshAll, t])

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
            to: '/sessions/$sessionId/vcs',
            params: { sessionId },
            search: nextTab === 'changes' ? {} : { tab: nextTab },
            replace: true,
        })
    }, [navigate, sessionId])

    const visibleTabs: { key: TabType; label: string }[] = [
        { key: 'changes', label: t('files.tab.changes') },
        { key: 'commits', label: t('files.tab.commits') },
        { key: 'branches', label: t('files.tab.branches') },
        { key: 'tags', label: t('files.tab.tags') },
        { key: 'stash', label: t('files.tab.stash') },
        { key: 'directories', label: t('files.tab.files') },
    ]

    return (
        <>
        <div className="flex h-full min-h-0 flex-col">
            {/* Header */}
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <button type="button" onClick={goBack} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]">
                        <IconLeft style={{ fontSize: 'var(--icon-xl)' }} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{t('files.header.git')}</div>
                        <div className="flex items-center gap-1.5 text-[length:var(--text-caption)] text-[var(--app-hint)]">
                            <IconBranch style={{ fontSize: 'var(--icon-xl)' }} />
                            <span className="truncate">{branchLabel}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <div className="relative" ref={actionsRef}>
                            <button
                                type="button"
                                onClick={() => setActionsOpen(v => !v)}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                                title={t('files.header.actions')}
                            >
                                <IconTool style={{ fontSize: 'var(--icon-xl)' }} />
                            </button>
                            {actionsOpen ? (
                                <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg">
                                    <Menu
                                        className="border-none bg-transparent"
                                        onClickMenuItem={(key) => {
                                            setActionsOpen(false)
                                            if (key === 'fetch' || key === 'pull' || key === 'push') setConfirmAction(key)
                                            if (key === 'stash') setStashOpen(true)
                                        }}
                                    >
                                        <Menu.Item key="fetch" disabled={anyActionLoading}>
                                            <div className="flex items-center gap-3">
                                                {gitActionLoading === 'fetch'
                                                    ? <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin text-[var(--app-hint)]" />
                                                    : <IconSync className="text-[var(--app-hint)]" style={{ fontSize: 'var(--icon-xl)' }} />}
                                                {t('git.fetch')}
                                            </div>
                                        </Menu.Item>
                                        <Menu.Item key="pull" disabled={anyActionLoading}>
                                            <div className="flex items-center gap-3">
                                                {gitActionLoading === 'pull'
                                                    ? <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin text-[var(--app-hint)]" />
                                                    : <IconArrowDown className="text-[var(--app-hint)]" style={{ fontSize: 'var(--icon-xl)' }} />}
                                                {t('git.pull')}
                                            </div>
                                        </Menu.Item>
                                        <Menu.Item key="push" disabled={anyActionLoading}>
                                            <div className="flex items-center gap-3">
                                                {gitActionLoading === 'push'
                                                    ? <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin text-[var(--app-hint)]" />
                                                    : <IconArrowDown className="rotate-180 text-[var(--app-hint)]" style={{ fontSize: 'var(--icon-xl)' }} />}
                                                {t('git.push')}
                                            </div>
                                        </Menu.Item>
                                        <Menu.Item key="stash" disabled={anyActionLoading}>
                                            <div className="flex items-center gap-3">
                                                <IconStorage className="text-[var(--app-hint)]" style={{ fontSize: 'var(--icon-xl)' }} />
                                                {t('git.stash')}
                                            </div>
                                        </Menu.Item>
                                    </Menu>
                                </div>
                            ) : null}
                        </div>
                        <button type="button" onClick={() => void handleRefreshAll()} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]" title={t('files.header.refresh')}>
                            <IconSync className={refreshing || gitLoading ? 'animate-spin' : ''} style={{ fontSize: 'var(--icon-xl)' }} />
                        </button>
                    </div>
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
                    {activeTab === 'commits' && (
                        <CommitsTab api={api} sessionId={sessionId} ahead={gitStatus?.ahead ?? 0} currentBranch={gitStatus?.branch ?? null} onRefresh={() => void handleRefreshAll()} />
                    )}
                    {activeTab === 'tags' && (
                        <TagsTab api={api} sessionId={sessionId} onRefresh={() => void handleRefreshAll()} />
                    )}
                    {activeTab === 'branches' && (
                        <BranchesTab api={api} sessionId={sessionId} currentBranch={gitStatus?.branch ?? null} onBranchChanged={() => void handleRefreshAll()} />
                    )}
                    {activeTab === 'stash' && (
                        <StashTab api={api} sessionId={sessionId} onRefresh={() => void handleRefreshAll()} />
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
        <StashSheet api={api} sessionId={sessionId} open={stashOpen} onClose={() => setStashOpen(false)} onStashChanged={() => void handleRefreshAll()} />
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
            onConfirm={async () => { await runGitAction('push', () => api.gitPush(sessionId, 'origin', 'HEAD')) }}
            isPending={gitActionLoading === 'push'}
        />
        </>
    )
}
