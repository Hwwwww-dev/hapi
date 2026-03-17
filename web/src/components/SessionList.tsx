import { useMemo, useState } from 'react'
import { getExplicitSessionTitle, getSessionListFallbackTitle, type SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SessionSourceBadge } from '@/components/SessionSourceBadge'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SESSION_AGENT_TABS, type SessionAgentTab } from '@/lib/agentFlavorUtils'
import { getSessionModelLabel } from '@/lib/sessionModelLabel'
import { useTranslation } from '@/lib/use-translation'
import type { SessionGroupState } from '@/hooks/queries/useSessions'

type SessionWithChildren = {
    session: SessionSummary
    nativeChildren: SessionSummary[]
}

type SessionGroup = {
    directory: string
    displayName: string
    sessions: SessionWithChildren[]
    totalSessions: number
    hasActiveSession: boolean
    hasMore: boolean
}


function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

function groupNativeChildren(sessions: SessionSummary[]): SessionWithChildren[] {
    // Build map: nativeSessionId → session (for all sessions)
    const sessionByNativeId = new Map<string, SessionSummary>()
    for (const s of sessions) {
        const nativeId = s.metadata?.nativeSessionId?.trim()
        if (nativeId) {
            sessionByNativeId.set(nativeId, s)
        }
    }

    const childIds = new Set<string>()
    const childrenByParentId = new Map<string, SessionSummary[]>()
    for (const s of sessions) {
        if (s.metadata?.source !== 'native') continue
        const parentNativeId = s.metadata?.parentNativeSessionId?.trim()
        if (!parentNativeId) continue
        const parent = sessionByNativeId.get(parentNativeId)
        if (!parent) continue
        childIds.add(s.id)
        const existing = childrenByParentId.get(parent.id) ?? []
        existing.push(s)
        childrenByParentId.set(parent.id, existing)
    }

    return sessions
        .filter(s => !childIds.has(s.id))
        .map(s => ({
            session: s,
            nativeChildren: childrenByParentId.get(s.id) ?? []
        }))
}


function getSessionListContentAnimationKey(agentTab: SessionAgentTab, groups: SessionGroup[]): string {
    const snapshot = groups
        .map((group) => `${group.directory}:${group.sessions.map((item) =>
            `${item.session.id}[${item.nativeChildren.map(c => c.id).join('+')}]`
        ).join(',')}`)
        .join('|')

    return `${agentTab}:${snapshot}`
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function BulbIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.2 1 2h6c0-.8.4-1.4 1-2a7 7 0 0 0-4-12Z" />
        </svg>
    )
}

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
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
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function FolderIcon(props: { className?: string }) {
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
            <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
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
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        </svg>
    )
}

function getSessionTitle(session: SessionSummary): string {
    return getExplicitSessionTitle(session) ?? getSessionListFallbackTitle(session)
}

function getTodoProgress(session: SessionSummary): { completed: number; total: number } | null {
    if (!session.todoProgress) return null
    if (session.todoProgress.completed === session.todoProgress.total) return null
    return session.todoProgress
}

function getAgentLabel(session: SessionSummary): string {
    const flavor = session.metadata?.flavor?.trim()
    if (flavor) return flavor
    return 'unknown'
}

function getNativeOriginLabel(session: SessionSummary): string | null {
    const source = session.metadata?.source
    if (source !== 'native' && source !== 'hybrid') return null

    const provider = session.metadata?.nativeProvider?.trim() || getAgentLabel(session)
    const nativeSessionId = session.metadata?.nativeSessionId?.trim()
    if (!nativeSessionId) return provider

    return `${provider} · ${nativeSessionId.slice(0, 8)}`
}

function getNativeSessionProviderLabel(session: SessionSummary): string | null {
    const nativeProvider = session.metadata?.nativeProvider?.trim()
    if (nativeProvider) {
        return nativeProvider
    }

    const source = session.metadata?.source
    if (source === 'native' || source === 'hybrid') {
        return getAgentLabel(session)
    }

    return null
}

function formatRelativeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.daysAgo', { n: days })
    return new Date(ms).toLocaleDateString()
}

function formatSessionTimes(session: SessionSummary, t: (key: string, params?: Record<string, string | number>) => string): string | null {
    const created = formatRelativeTime(session.createdAt, t)
    const updated = formatRelativeTime(session.updatedAt, t)

    if (created && updated) {
        return `${t('session.time.createdLabel')} ${created} · ${t('session.time.updatedLabel')} ${updated}`
    }

    if (updated) {
        return `${t('session.time.updatedLabel')} ${updated}`
    }

    if (created) {
        return `${t('session.time.createdLabel')} ${created}`
    }

    return null
}

function getRelativeSessionPath(session: SessionSummary, groupDirectory: string): string | null {
    const sessionPath = session.metadata?.path?.trim()
    if (!sessionPath || groupDirectory === 'Other') {
        return null
    }

    const normalizedGroup = groupDirectory.replace(/[\\/]+$/, '')
    if (sessionPath === normalizedGroup) {
        return null
    }

    if (sessionPath.startsWith(normalizedGroup)) {
        const remainder = sessionPath.slice(normalizedGroup.length).replace(/^[\\/]+/, '')
        return remainder.length > 0 ? remainder : null
    }

    return sessionPath
}

function SessionItem(props: {
    session: SessionSummary
    nativeChildren: SessionSummary[]
    onSelect: (sessionId: string) => void
    groupDirectory: string
    api: ApiClient | null
    selected?: boolean
    selectedSessionId?: string | null
}) {
    const { t } = useTranslation()
    const { session: s, onSelect, groupDirectory, api, selected = false } = props
    const { haptic } = usePlatform()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const hasChildren = props.nativeChildren.length > 0
    const hasActiveChild = props.nativeChildren.some(c => c.active)
    const [childrenExpanded, setChildrenExpanded] = useState(() => hasActiveChild)

    const { archiveSession, renameSession, deleteSession, isPending } = useSessionActions(
        api,
        s.id,
        s.metadata?.flavor ?? null
    )

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const nativeSessionProviderLabel = getNativeSessionProviderLabel(s)
    const nativeSessionId = s.metadata?.nativeSessionId?.trim() || null
    const relativeSessionPath = getRelativeSessionPath(s, groupDirectory)
    const sessionTimes = formatSessionTimes(s, t)
    const modelLabel = getSessionModelLabel(s)
    const statusDotClass = s.active
        ? (s.thinking ? 'bg-[#007AFF]' : 'bg-[var(--app-badge-success-text)]')
        : 'bg-[var(--app-hint)]'
    return (
        <>
            <button
                type="button"
                {...longPressHandlers}
                className={`session-list-item flex w-full flex-col gap-2 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none ${selected ? 'border-[var(--app-link)] bg-[var(--app-secondary-bg)]' : 'border-[var(--app-divider)] bg-[var(--app-bg)] hover:bg-[var(--app-secondary-bg)]'}`}
                style={{ WebkitTouchCallout: 'none' }}
                aria-current={selected ? 'page' : undefined}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                            <span
                                className={`h-2 w-2 rounded-full ${statusDotClass}`}
                            />
                        </span>
                        <div className="truncate text-sm font-medium sm:text-base">
                            {sessionName}
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
                        <div className="flex items-center gap-1">
                            <SessionSourceBadge source={s.metadata?.source} className="shrink-0" />
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {s.thinking ? (
                                <span className="rounded-full bg-[#007AFF]/10 px-2 py-0.5 text-[#007AFF] animate-pulse">
                                    {t('session.item.thinking')}
                                </span>
                            ) : null}
                            {(() => {
                                const progress = getTodoProgress(s)
                                if (!progress) return null
                                return (
                                    <span className="flex items-center gap-1 rounded-full bg-[var(--app-secondary-bg)] px-2 py-0.5 text-[var(--app-hint)]">
                                        <BulbIcon className="h-3 w-3" />
                                        {progress.completed}/{progress.total}
                                    </span>
                                )
                            })()}
                            {s.pendingRequestsCount > 0 ? (
                                <span className="rounded-full bg-[var(--app-badge-warning-bg)] px-2 py-0.5 text-[var(--app-badge-warning-text)]">
                                    {t('session.item.pending')} {s.pendingRequestsCount}
                                </span>
                            ) : null}
                        </div>
                    </div>
                </div>
                <div className="space-y-1 pl-6 text-[10px] leading-4 text-[var(--app-hint)]">
                    <div className="break-all font-mono">
                        <span className="mr-2 font-semibold text-[var(--app-fg)]">HAPI</span>
                        <span>{s.id}</span>
                    </div>
                    {nativeSessionId && nativeSessionProviderLabel ? (
                        <div className="break-all font-mono">
                            <span className="mr-2 font-semibold text-[var(--app-fg)]">{nativeSessionProviderLabel}</span>
                            <span>{nativeSessionId}</span>
                        </div>
                    ) : null}
                </div>
                {relativeSessionPath ? (
                    <div className="break-all pl-6 text-[11px] leading-4 text-[var(--app-hint)]">
                        {relativeSessionPath}
                    </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pl-6 text-[11px] text-[var(--app-hint)]">
                    <span className="inline-flex items-center gap-1.5">
                        <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                            ❖
                        </span>
                        {getAgentLabel(s)}
                    </span>
                    {modelLabel ? (
                        <span>{t(modelLabel.key)}: {modelLabel.value}</span>
                    ) : null}
                    {s.metadata?.worktree?.branch ? (
                        <span>{t('session.item.worktree')}: {s.metadata.worktree.branch}</span>
                    ) : null}
                </div>
                {sessionTimes ? (
                    <div className="pl-6 text-[11px] leading-4 text-[var(--app-hint)]">
                        {sessionTimes}
                    </div>
                ) : null}
            </button>

            {hasChildren && (
                <button
                    type="button"
                    onClick={() => setChildrenExpanded(v => !v)}
                    className="flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--app-divider)] px-3 py-1.5 text-left text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                    aria-label={childrenExpanded ? 'Collapse subagents' : 'Expand subagents'}
                >
                    <span>{childrenExpanded ? '▾' : '▸'}</span>
                    <span>{props.nativeChildren.length} {t('session.item.subagents')}</span>
                </button>
            )}

            {hasChildren && childrenExpanded && (
                <div className="ml-3 flex flex-col gap-1 border-l border-dashed border-[var(--app-divider)] pl-3">
                    {props.nativeChildren.map(child => (
                        <button
                            key={child.id}
                            type="button"
                            onClick={() => props.onSelect(child.id)}
                            className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] ${child.id === props.selectedSessionId ? 'border-[var(--app-link)] bg-[var(--app-secondary-bg)]' : 'border-[var(--app-divider)] bg-[var(--app-bg)] hover:bg-[var(--app-secondary-bg)]'}`}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[var(--app-hint)] shrink-0">↳</span>
                                <span className="truncate font-medium">{getSessionTitle(child)}</span>
                                {child.active && (
                                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${child.thinking ? 'bg-[#007AFF] animate-pulse' : 'bg-[var(--app-badge-success-text)]'}`} />
                                )}
                            </div>
                            {child.metadata?.nativeSessionId ? (
                                <div className="pl-4 font-mono text-[10px] text-[var(--app-hint)] truncate">
                                    <span className="font-semibold text-[var(--app-fg)] mr-1">{getNativeOriginLabel(child)}</span>
                                </div>
                            ) : null}
                        </button>
                    ))}
                </div>
            )}

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={s.active}
                onRename={() => setRenameOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={sessionName}
                onRename={renameSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: sessionName })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: sessionName })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={deleteSession}
                isPending={isPending}
                destructive
            />
        </>
    )
}

export function SessionList(props: {
    groups: SessionGroupState[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onRefresh: () => void
    isLoading: boolean
    renderHeader?: boolean
    api: ApiClient | null
    selectedSessionId?: string | null
    agentTab?: SessionAgentTab
    onAgentTabChange?: (tab: SessionAgentTab) => void
    loadMoreForDirectory?: (directory: string) => Promise<void>
    isLoadingMoreFor?: (directory: string) => boolean
}) {
    const { t } = useTranslation()
    const { renderHeader = true, api, selectedSessionId, agentTab = 'claude', onAgentTabChange } = props

    // Build SessionGroup for rendering (no tab filtering needed - backend already filtered by flavor)
    const groups: SessionGroup[] = useMemo(() => {
        return props.groups
            .map(g => {
                const withChildren = groupNativeChildren(g.sessions)
                const hasActiveSession = g.sessions.some(s => s.active)
                return {
                    directory: g.directory,
                    displayName: getGroupDisplayName(g.directory),
                    sessions: withChildren,
                    totalSessions: g.total,
                    hasActiveSession,
                    hasMore: g.hasMore,
                }
            })
            .filter(g => g.sessions.length > 0)
    }, [props.groups])

    const visibleSessionCount = useMemo(
        () => groups.reduce((sum, group) => sum + group.sessions.length, 0),
        [groups]
    )
    const contentAnimationKey = useMemo(
        () => getSessionListContentAnimationKey(agentTab, groups),
        [agentTab, groups]
    )
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const isGroupCollapsed = (group: SessionGroup): boolean => {
        const override = collapseOverrides.get(group.directory)
        if (override !== undefined) return override
        return !group.hasActiveSession
    }

    const toggleGroup = (directory: string, isCollapsed: boolean) => {
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(directory, !isCollapsed)
            return next
        })
    }

    return (
        <div className="mx-auto w-full max-w-content flex flex-col">
            {renderHeader ? (
                <div className="flex items-center justify-between px-3 py-2">
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('sessions.count', { n: visibleSessionCount, m: groups.length })}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={props.onRefresh}
                            className="rounded-full p-1.5 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.chat.refresh')}
                            aria-busy={props.isLoading}
                        >
                            <RefreshIcon className={`h-4 w-4 ${props.isLoading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            type="button"
                            onClick={props.onNewSession}
                            className="session-list-new-button rounded-full p-1.5 text-[var(--app-link)] transition-colors"
                            title={t('sessions.new')}
                        >
                            <PlusIcon className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            ) : null}

            <div className="border-b border-[var(--app-divider)] px-2 pb-2">
                <div className="scrollbar-hidden overflow-x-auto" role="tablist" aria-label={t('sessions.tabsLabel')}>
                    <div className="flex min-w-max items-center gap-1">
                        {SESSION_AGENT_TABS.map((tab) => {
                            const selected = tab === agentTab
                            const label = t(`sessions.tab.${tab}`)
                            return (
                                <button
                                    key={tab}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    onClick={() => onAgentTabChange?.(tab)}
                                    className={`relative rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${selected ? 'bg-[var(--app-button)] text-[var(--app-button-text)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'}`}
                                >
                                    {label}
                                </button>
                            )
                        })}
                    </div>
                </div>
            </div>

            <div
                key={contentAnimationKey}
                data-testid="session-list-content"
                className="animate-session-list-swap flex flex-col gap-2 px-2 pb-2"
            >
                {groups.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[var(--app-divider)] px-4 py-6 text-center text-sm text-[var(--app-hint)]">
                        {t('sessions.empty')}
                    </div>
                ) : null}
                {groups.map((group) => {
                    const isCollapsed = isGroupCollapsed(group)
                    const mainCount = group.sessions.filter(item => !item.session.metadata?.parentNativeSessionId).length
                    const countLabel = group.hasMore ? `${mainCount}/${group.totalSessions}` : `${mainCount}`
                    const isLoadingMore = props.isLoadingMoreFor?.(group.directory) ?? false
                    return (
                        <div key={group.directory} className="overflow-hidden rounded-2xl border border-[var(--app-divider)] bg-[var(--app-bg)]">
                            <button
                                type="button"
                                onClick={() => toggleGroup(group.directory, isCollapsed)}
                                className="sticky top-0 z-10 flex w-full items-center gap-3 border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--app-secondary-bg)]"
                            >
                                <ChevronIcon
                                    className="h-4 w-4 text-[var(--app-hint)]"
                                    collapsed={isCollapsed}
                                />
                                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${group.hasActiveSession ? 'bg-[var(--app-secondary-bg)] text-[var(--app-link)]' : 'bg-[var(--app-secondary-bg)] text-[var(--app-hint)]'}`}>
                                    <FolderIcon className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="truncate font-medium text-sm sm:text-base" title={group.directory}>
                                            {group.displayName}
                                        </span>
                                        <span className="shrink-0 rounded-full bg-[var(--app-secondary-bg)] px-2 py-0.5 text-[11px] text-[var(--app-hint)]">
                                            {countLabel}
                                        </span>
                                    </div>
                                    {group.directory !== 'Other' ? (
                                        <div className="truncate text-[11px] text-[var(--app-hint)]">
                                            {group.directory}
                                        </div>
                                    ) : null}
                                </div>
                            </button>
                            {!isCollapsed ? (
                                <div className="bg-[var(--app-secondary-bg)] p-2">
                                    <div className="flex flex-col gap-2 border-l border-dashed border-[var(--app-divider)] pl-3">
                                    {group.sessions.map((item) => (
                                        <SessionItem
                                            key={item.session.id}
                                            session={item.session}
                                            nativeChildren={item.nativeChildren}
                                            onSelect={props.onSelect}
                                            groupDirectory={group.directory}
                                            api={api}
                                            selected={item.session.id === selectedSessionId}
                                            selectedSessionId={selectedSessionId}
                                        />
                                    ))}
                                    {group.hasMore ? (
                                        <button
                                            type="button"
                                            onClick={() => { void props.loadMoreForDirectory?.(group.directory) }}
                                            disabled={isLoadingMore}
                                            className="w-full rounded-xl border border-dashed border-[var(--app-divider)] px-3 py-2 text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-divider)] disabled:opacity-50"
                                        >
                                            {isLoadingMore ? t('sessions.loadingMore') : t('sessions.loadMore')}
                                        </button>
                                    ) : null}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
