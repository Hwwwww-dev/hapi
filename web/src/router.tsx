import { lazy, Suspense, startTransition, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Session } from '@/types/api'
import {
    Navigate,
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation,
    useMatchRoute,
    useNavigate,
    useParams,

} from '@tanstack/react-router'
import { App } from '@/App'
import { SessionChat } from '@/components/SessionChat'
import { SessionList } from '@/components/SessionList'
import { NewSession } from '@/components/NewSession'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useMessages } from '@/hooks/queries/useMessages'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSession } from '@/hooks/queries/useSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useSkills } from '@/hooks/queries/useSkills'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'
import { clearDraftsAfterSend } from '@/lib/clearDraftsAfterSend'
import { getTabFlavor, getTabActive, loadAgentTab, saveAgentTab, type SessionAgentTab } from '@/lib/agentFlavorUtils'
import { notify } from '@/lib/notify'
import { IconLeft, IconPlus, IconSync, IconSettings } from '@arco-design/web-react/icon'
import { ChatErrorBoundary } from '@/components/ChatErrorBoundary'
const FilesPage = lazy(() => import('@/routes/sessions/files'))
const FilePage = lazy(() => import('@/routes/sessions/file'))
const TerminalPage = lazy(() => import('@/routes/sessions/terminal'))
const SettingsPage = lazy(() => import('@/routes/settings'))

function SessionsPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const pathname = useLocation({ select: location => location.pathname })
    const matchRoute = useMatchRoute()
    const { t } = useTranslation()
    const [agentTab, setAgentTab] = useState<SessionAgentTab>(loadAgentTab)
    const { sessions, groups, isLoading, error, refetch, removeSession, loadMoreForDirectory, isLoadingMoreFor } = useSessions(api, getTabFlavor(agentTab), getTabActive(agentTab))

    const handleRefresh = useCallback(() => {
        void refetch().then(() => notify.success(t('notify.refreshed'), 1500))
    }, [refetch, t])

    const projectCount = groups.length
    const sessionMatch = matchRoute({ to: '/sessions/$sessionId', fuzzy: true })
    const selectedSessionId = sessionMatch && sessionMatch.sessionId !== 'new' ? sessionMatch.sessionId : null
    const isSessionsIndex = pathname === '/sessions' || pathname === '/sessions/'
    const handleAgentTabChange = useCallback((nextTab: SessionAgentTab) => {
        saveAgentTab(nextTab)
        setAgentTab(nextTab)
    }, [])

    return (
        <div className="relative flex h-full min-h-0">
            <div
                className={`flex w-full lg:w-[420px] xl:w-[480px] shrink-0 flex-col bg-[var(--app-bg)] lg:border-r lg:border-[var(--app-divider)]${isSessionsIndex ? '' : ' invisible absolute inset-0 pointer-events-none lg:visible lg:static lg:pointer-events-auto'}`}
            >
                <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                    <div className="mx-auto w-full max-w-content flex items-center justify-between px-3 py-2">
                        <div className="text-[length:var(--text-caption)] text-[var(--app-hint)]">
                            {t('sessions.count', { n: sessions.length, m: projectCount })}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleRefresh}
                                className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                                title={t('session.chat.refresh')}
                                aria-busy={isLoading}
                            >
                                <IconSync className={isLoading ? 'animate-spin' : ''} style={{ fontSize: 'var(--icon-xl)' }} />
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate({ to: '/settings' })}
                                className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                                title={t('settings.title')}
                            >
                                <IconSettings style={{ fontSize: 'var(--icon-xl)' }} />
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate({ to: '/sessions/new' })}
                                className="session-list-new-button p-1.5 rounded-full text-[var(--app-link)] transition-colors"
                                title={t('sessions.new')}
                            >
                                <IconPlus style={{ fontSize: 'var(--icon-2xl)' }} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="app-scroll-y flex-1 min-h-0 desktop-scrollbar-left">
                    {error ? (
                        <div className="mx-auto w-full max-w-content px-3 py-2">
                            <div className="text-[length:var(--text-body)] text-red-600">{error}</div>
                        </div>
                    ) : null}
                    <SessionList
                        groups={groups}
                        agentTab={agentTab}
                        onAgentTabChange={handleAgentTabChange}
                        selectedSessionId={selectedSessionId}
                        onSelect={(sessionId) => navigate({
                            to: '/sessions/$sessionId',
                            params: { sessionId },
                            replace: !!selectedSessionId,
                        })}
                        onNewSession={() => navigate({ to: '/sessions/new' })}
                        onRefresh={handleRefresh}
                        isLoading={isLoading}
                        renderHeader={false}
                        api={api}
                        loadMoreForDirectory={loadMoreForDirectory}
                        isLoadingMoreFor={isLoadingMoreFor}
                        removeSession={removeSession}
                        onDeletedNavigate={() => navigate({
                            to: '/sessions',
                            replace: true,
                        })}
                    />
                </div>
            </div>

            <div className={`flex min-w-0 flex-1 flex-col bg-[var(--app-bg)]${isSessionsIndex ? ' invisible absolute inset-0 pointer-events-none lg:visible lg:static lg:pointer-events-auto' : ''}`}>
                <div className="flex-1 min-h-0">
                    <Outlet />
                </div>
            </div>
        </div>
    )
}

function SessionsIndexPage() {
    return null
}

function SessionPage() {
    const { api } = useAppContext()
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const { t } = useTranslation()
    const {
        session,
        refetch: refetchSession,
    } = useSession(api, sessionId)

    if (!session || !api) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <LoadingState label={t('loading.session')} className="text-[length:var(--text-body)]" />
            </div>
        )
    }

    return (
        <SessionPageContent
            api={api}
            session={session}
            sessionId={sessionId}
            refetchSession={refetchSession}
        />
    )
}

function SessionPageContent(props: {
    api: ApiClient
    session: Session
    sessionId: string
    refetchSession: () => Promise<unknown>
}) {
    const { api, session, sessionId, refetchSession } = props
    const { t } = useTranslation()
    const navigate = useNavigate()
    const goBack = useCallback(() => {
        startTransition(() => {
            navigate({ to: '/sessions', replace: true })
        })
    }, [navigate])
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const {
        messages,
        warning: messagesWarning,
        isLoading: messagesLoading,
        isLoadingMore: messagesLoadingMore,
        hasMore: messagesHasMore,
        loadMore: loadMoreMessages,
        refetch: refetchMessages,
        pendingCount,
        totalMessages,
        messagesVersion,
        flushPending,
        setAtBottom,
    } = useMessages(api, sessionId)
    const {
        sendMessage,
        sendQueued,
        retryMessage,
        isSending,
    } = useSendMessage(api, sessionId, {
        onSuccess: (sentSessionId) => {
            clearDraftsAfterSend(sentSessionId, sessionId)
        },
        resolveSessionId: async (currentSessionId) => {
            if (!api || !session || session.active) {
                return currentSessionId
            }
            try {
                return await api.resumeSession(currentSessionId)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Resume failed'
                addToast({
                    title: 'Resume failed',
                    body: message,
                    sessionId: currentSessionId,
                    url: ''
                })
                throw error
            }
        },
        onSessionResolved: (resolvedSessionId) => {
            void (async () => {
                if (api) {
                    if (session && resolvedSessionId !== session.id) {
                        seedMessageWindowFromSession(session.id, resolvedSessionId)
                        queryClient.setQueryData(queryKeys.session(resolvedSessionId), {
                            session: { ...session, id: resolvedSessionId, active: true }
                        })
                    }
                    try {
                        await Promise.all([
                            queryClient.prefetchQuery({
                                queryKey: queryKeys.session(resolvedSessionId),
                                queryFn: () => api.getSession(resolvedSessionId),
                            }),
                            fetchLatestMessages(api, resolvedSessionId),
                        ])
                    } catch {
                    }
                }
                navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: resolvedSessionId },
                    replace: true
                })
            })()
        },
        onBlocked: (reason) => {
            if (reason === 'no-api') {
                addToast({
                    title: t('send.blocked.title'),
                    body: t('send.blocked.noConnection'),
                    sessionId: sessionId ?? '',
                    url: ''
                })
            }
            // 'no-session' and 'pending' don't need toast - either invalid state or expected behavior
        }
    })

    // Get agent type from session metadata for slash commands
    const agentType = session?.metadata?.flavor ?? 'claude'
    const {
        commands: slashCommands,
        getSuggestions: getSlashSuggestions,
    } = useSlashCommands(api, sessionId, agentType)
    const {
        getSuggestions: getSkillSuggestions,
    } = useSkills(api, sessionId)

    const getAutocompleteSuggestions = useCallback(async (query: string) => {
        if (query.startsWith('$')) {
            return await getSkillSuggestions(query)
        }
        return await getSlashSuggestions(query)
    }, [getSkillSuggestions, getSlashSuggestions])

    const refreshSelectedSession = useCallback(() => {
        void refetchSession()
        void refetchMessages()
    }, [refetchMessages, refetchSession])

    return (
        <SessionChat
            api={api}
            session={session}
            messages={messages}
            messagesWarning={messagesWarning}
            hasMoreMessages={messagesHasMore}
            isLoadingMessages={messagesLoading}
            isLoadingMoreMessages={messagesLoadingMore}
            isSending={isSending}
            pendingCount={pendingCount}
            totalMessages={totalMessages}
            messagesVersion={messagesVersion}
            onBack={goBack}
            onRefresh={refreshSelectedSession}
            onLoadMore={loadMoreMessages}
            onSend={sendMessage}
            onFlushPending={flushPending}
            onAtBottomChange={setAtBottom}
            onRetryMessage={retryMessage}
            autocompleteSuggestions={getAutocompleteSuggestions}
            onSendQueued={sendQueued}
            sessionId={sessionId}
            availableSlashCommands={slashCommands}
        />
    )
}

function SessionDetailRoute() {
    const pathname = useLocation({ select: location => location.pathname })
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const { t } = useTranslation()
    const basePath = `/sessions/${sessionId}`
    const isChat = pathname === basePath || pathname === `${basePath}/`

    // Keep SessionPage mounted (hidden) on child routes to avoid
    // re-initialising heavy hooks (useMessages, useSendMessage …)
    // when swiping back — gives native-app-like instant transitions.
    return (
        <>
            <div className={isChat ? 'contents' : 'hidden'}>
                <ChatErrorBoundary t={t}>
                    <SessionPage />
                </ChatErrorBoundary>
            </div>
            {!isChat && <Outlet />}
        </>
    )
}

function NewSessionPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    const queryClient = useQueryClient()
    const { machines, isLoading: machinesLoading, error: machinesError } = useMachines(api, true)
    const { t } = useTranslation()

    const handleCancel = useCallback(() => {
        navigate({ to: '/sessions', replace: true })
    }, [navigate])

    const handleSuccess = useCallback((sessionId: string) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        // Replace current page with /sessions to clear spawn flow from history
        navigate({ to: '/sessions', replace: true })
        // Then navigate to new session
        requestAnimationFrame(() => {
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId },
            })
        })
    }, [navigate, queryClient])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <IconLeft style={{ fontSize: 'var(--icon-xl)' }} />
                    </button>
                )}
                <div className="flex-1 font-semibold">{t('newSession.title')}</div>
            </div>

            <div
                className="app-scroll-y flex-1 min-h-0"
                style={{ paddingBottom: 'calc(var(--app-floating-bottom-offset, 0px) + env(safe-area-inset-bottom))' }}
            >
                {machinesError ? (
                    <div className="p-3 text-sm text-red-600">
                        {machinesError}
                    </div>
                ) : null}

                <NewSession
                    api={api}
                    machines={machines}
                    isLoading={machinesLoading}
                    onCancel={handleCancel}
                    onSuccess={handleSuccess}
                />
            </div>
        </div>
    )
}

const LazySuspense = (props: { children: React.ReactNode }) => (
    <Suspense fallback={<div className="flex justify-center py-8"><span className="w-5 h-5 border-2 border-[var(--app-link)] border-t-transparent rounded-full animate-spin" /></div>}>
        {props.children}
    </Suspense>
)

const rootRoute = createRootRoute({
    component: App,
})

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Navigate to="/sessions" replace />,
})

const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions',
    component: SessionsPage,
})

const sessionsIndexRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '/',
    component: SessionsIndexPage,
})

const sessionDetailRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '$sessionId',
    component: SessionDetailRoute,
})

const sessionFilesRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'vcs',
    validateSearch: (search: Record<string, unknown>): { tab?: 'changes' | 'commits' | 'tags' | 'branches' | 'stash' | 'directories' } => {
        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const validTabs = ['changes', 'commits', 'tags', 'branches', 'stash', 'directories'] as const
        const tab = validTabs.find(t => t === tabValue)

        return tab ? { tab } : {}
    },
    component: () => <LazySuspense><FilesPage /></LazySuspense>,
})

const sessionTerminalRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'terminal',
    component: () => <LazySuspense><TerminalPage /></LazySuspense>,
})

type SessionFileSearch = {
    path: string
    staged?: boolean
    hash?: string
    tab?: 'changes' | 'commits' | 'tags' | 'branches' | 'directories'
}

const sessionFileRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'file',
    validateSearch: (search: Record<string, unknown>): SessionFileSearch => {
        const path = typeof search.path === 'string' ? search.path : ''
        const staged = search.staged === true || search.staged === 'true'
            ? true
            : search.staged === false || search.staged === 'false'
                ? false
                : undefined

        const hash = typeof search.hash === 'string' && search.hash ? search.hash : undefined

        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : tabValue === 'commits'
                    ? 'commits'
                    : tabValue === 'tags'
                        ? 'tags'
                        : tabValue === 'branches'
                            ? 'branches'
                            : undefined

        const result: SessionFileSearch = { path }
        if (staged !== undefined) result.staged = staged
        if (hash !== undefined) result.hash = hash
        if (tab !== undefined) result.tab = tab
        return result
    },
    component: () => <LazySuspense><FilePage /></LazySuspense>,
})

const newSessionRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: 'new',
    component: NewSessionPage,
})

const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: () => <LazySuspense><SettingsPage /></LazySuspense>,
})

export const routeTree = rootRoute.addChildren([
    indexRoute,
    sessionsRoute.addChildren([
        sessionsIndexRoute,
        newSessionRoute,
        sessionDetailRoute.addChildren([
            sessionTerminalRoute,
            sessionFilesRoute,
            sessionFileRoute,
        ]),
    ]),
    settingsRoute,
])

type RouterHistory = Parameters<typeof createRouter>[0]['history']

export function createAppRouter(history?: RouterHistory) {
    return createRouter({
        routeTree,
        history,
        scrollRestoration: true,
    })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
    interface Register {
        router: AppRouter
    }
}
