import { useId, useMemo, useRef, useState } from 'react'
import { getExplicitSessionTitle, getSessionPathFallbackTitle, type Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { formatFlavorName } from '@/lib/agentFlavorUtils'
import { AgentIcon } from '@/components/AgentIcon'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SessionSourceBadge } from '@/components/SessionSourceBadge'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getSessionModelLabel } from '@/lib/sessionModelLabel'
import { useTranslation } from '@/lib/use-translation'
import { notify } from '@/lib/notify'
import { IconBranch, IconMoreVertical, IconLeft, IconPlus } from '@arco-design/web-react/icon'
import { useNavigate } from '@tanstack/react-router'

function getSessionTitle(session: Session): string {
    return getExplicitSessionTitle(session) ?? getSessionPathFallbackTitle(session)
}

export function SessionHeader(props: {
    session: Session
    onBack: () => void
    onViewFiles?: () => void
    api: ApiClient | null
    onSessionDeleted?: () => void
    onRefreshAction?: () => void
    onConnectionToggle?: () => void
    statusActionPending?: boolean
    readOnly?: boolean
}) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { session, api, onSessionDeleted } = props
    const title = useMemo(() => getSessionTitle(session), [session])
    const worktreeBranch = session.metadata?.worktree?.branch
    const nativeSessionId = session.metadata?.nativeSessionId?.trim() || null
    const modelLabel = getSessionModelLabel(session)

    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const menuId = useId()
    const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [titleExpanded, setTitleExpanded] = useState(false)

    const handleTitleClick = () => {
        if (!titleExpanded) {
            navigator.clipboard?.writeText(title).then(() => notify.success(t('notify.copied'), 2000)).catch(() => {})
        }
        setTitleExpanded((v) => !v)
    }

    const { archiveSession, renameSession, deleteSession, isPending } = useSessionActions(
        api,
        session.id,
        session.metadata?.flavor ?? null,
        undefined,
        onSessionDeleted
    )

    const handleDelete = async () => {
        await deleteSession()
    }

    const handleMenuToggle = () => {
        if (!menuOpen && menuAnchorRef.current) {
            const rect = menuAnchorRef.current.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.right, y: rect.bottom })
        }
        setMenuOpen((open) => !open)
    }

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3">
                    {/* Back button */}
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <IconLeft style={{ fontSize: 'var(--icon-xl)' }} />
                    </button>

                    {/* Session info */}
                    <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-1.5 min-w-0">
                            <div
                                className={`text-sm font-semibold break-all cursor-pointer ${titleExpanded ? '' : 'truncate'}`}
                                onClick={handleTitleClick}
                            >
                                {title}
                            </div>
                            <SessionSourceBadge source={session.metadata?.source} className="shrink-0 mt-0.5" />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-[length:var(--text-badge)] text-[var(--app-hint)]">
                            <span className="inline-flex items-center gap-1 shrink-0">
                                <AgentIcon flavor={session.metadata?.flavor} size="var(--icon-sm)" />
                                {formatFlavorName(session.metadata?.flavor)}
                            </span>
                            {modelLabel ? (
                                <span className="shrink-0">{modelLabel.value}</span>
                            ) : null}
                            {worktreeBranch ? (
                                <span className="shrink-0">{worktreeBranch}</span>
                            ) : null}
                            {nativeSessionId ? (
                                <span
                                    className="font-mono break-all cursor-pointer hover:text-[var(--app-fg)] transition-colors"
                                    onClick={() => navigator.clipboard?.writeText(nativeSessionId).then(() => notify.success(t('notify.copied'), 2000)).catch(() => {})}
                                >
                                    {nativeSessionId}
                                </span>
                            ) : null}
                        </div>
                    </div>

                    {props.onViewFiles && !props.readOnly ? (
                        <button
                            type="button"
                            onClick={props.onViewFiles}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.title')}
                        >
                            <IconBranch style={{ fontSize: 'var(--icon-lg)' }} />
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={() => navigate({ to: '/sessions/new' })}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.newSession')}
                    >
                        <IconPlus style={{ fontSize: 'var(--icon-md)' }} />
                    </button>

                    {!props.readOnly && (
                    <button
                        type="button"
                        onClick={handleMenuToggle}
                        onPointerDown={(e) => e.stopPropagation()}
                        ref={menuAnchorRef}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? menuId : undefined}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.more')}
                    >
                        <IconMoreVertical style={{ fontSize: 'var(--icon-lg)' }} />
                    </button>
                    )}
                </div>
            </div>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={session.active}
                onRefresh={props.onRefreshAction}
                onConnectionToggle={props.onConnectionToggle}
                onRename={() => setRenameOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
                menuId={menuId}
                actionBusy={props.statusActionPending}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={title}
                onRename={renameSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: title })}
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
                description={t('dialog.delete.description', { name: title })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={handleDelete}
                isPending={isPending}
                destructive
            />
        </>
    )
}
