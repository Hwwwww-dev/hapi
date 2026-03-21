import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties
} from 'react'
import { Menu } from '@arco-design/web-react'
import { IconEdit, IconDelete, IconRefresh, IconLink } from '@arco-design/web-react/icon'
import { useTranslation } from '@/lib/use-translation'

type SessionActionMenuProps = {
    isOpen: boolean
    onClose: () => void
    sessionActive: boolean
    onRefresh?: () => void
    onConnectionToggle?: () => void
    onRename: () => void
    onArchive: () => void
    onDelete: () => void
    anchorPoint: { x: number; y: number }
    menuId?: string
    actionBusy?: boolean
}

type MenuPosition = {
    top: number
    left: number
    transformOrigin: string
}

export function SessionActionMenu(props: SessionActionMenuProps) {
    const { t } = useTranslation()
    const {
        isOpen,
        onClose,
        sessionActive,
        onRefresh,
        onConnectionToggle,
        onRename,
        onArchive,
        onDelete,
        anchorPoint,
        menuId,
        actionBusy = false
    } = props
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
    const internalId = useId()
    const resolvedMenuId = menuId ?? `session-action-menu-${internalId}`
    const headingId = `${resolvedMenuId}-heading`

    const handleClickMenu = (key: string) => {
        onClose()
        switch (key) {
            case 'refresh': onRefresh?.(); break
            case 'connection': onConnectionToggle?.(); break
            case 'rename': onRename(); break
            case 'archive': onArchive(); break
            case 'delete': onDelete(); break
        }
    }

    const updatePosition = useCallback(() => {
        const menuEl = menuRef.current
        if (!menuEl) return

        const menuRect = menuEl.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const padding = 8
        const gap = 8

        const spaceBelow = viewportHeight - anchorPoint.y
        const spaceAbove = anchorPoint.y
        const openAbove = spaceBelow < menuRect.height + gap && spaceAbove > spaceBelow

        let top = openAbove ? anchorPoint.y - menuRect.height - gap : anchorPoint.y + gap
        let left = anchorPoint.x - menuRect.width / 2
        const transformOrigin = openAbove ? 'bottom center' : 'top center'

        top = Math.min(Math.max(top, padding), viewportHeight - menuRect.height - padding)
        left = Math.min(Math.max(left, padding), viewportWidth - menuRect.width - padding)

        setMenuPosition({ top, left, transformOrigin })
    }, [anchorPoint])

    useLayoutEffect(() => {
        if (!isOpen) return
        updatePosition()
    }, [isOpen, updatePosition])

    useEffect(() => {
        if (!isOpen) {
            setMenuPosition(null)
            return
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (menuRef.current?.contains(target)) return
            onClose()
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose()
            }
        }

        const handleReflow = () => {
            updatePosition()
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('resize', handleReflow)
        window.addEventListener('scroll', handleReflow, true)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('resize', handleReflow)
            window.removeEventListener('scroll', handleReflow, true)
        }
    }, [isOpen, onClose, updatePosition])

    useEffect(() => {
        if (!isOpen) return

        const frame = window.requestAnimationFrame(() => {
            const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
            firstItem?.focus()
        })

        return () => window.cancelAnimationFrame(frame)
    }, [isOpen])

    if (!isOpen) return null

    const menuStyle: CSSProperties | undefined = menuPosition
        ? {
            top: menuPosition.top,
            left: menuPosition.left,
            transformOrigin: menuPosition.transformOrigin
        }
        : undefined

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
            style={menuStyle}
        >
            <div
                id={headingId}
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]"
            >
                {t('session.more')}
            </div>
            <Menu
                mode="pop"
                onClickMenuItem={handleClickMenu}
                className="!border-0 !shadow-none !bg-transparent !p-0"
                style={{ width: '100%' }}
            >
                {onRefresh ? (
                    <Menu.Item key="refresh" disabled={actionBusy}>
                        <div className="flex items-center gap-3">
                            <IconRefresh className="text-[var(--app-hint)]" style={{ fontSize: 18 }} />
                            {t('session.chat.refresh')}
                        </div>
                    </Menu.Item>
                ) : null}

                {onConnectionToggle ? (
                    <Menu.Item key="connection" disabled={actionBusy}>
                        <div className="flex items-center gap-3">
                            <IconLink className="text-[var(--app-hint)]" style={{ fontSize: 18 }} />
                            {sessionActive ? t('session.chat.disconnect') : t('session.chat.connect')}
                        </div>
                    </Menu.Item>
                ) : null}

                <Menu.Item key="rename">
                    <div className="flex items-center gap-3">
                        <IconEdit className="text-[var(--app-hint)]" style={{ fontSize: 18 }} />
                        {t('session.action.rename')}
                    </div>
                </Menu.Item>

                {sessionActive && !onConnectionToggle ? (
                    <Menu.Item key="archive" className="!text-red-500">
                        <div className="flex items-center gap-3">
                            <IconLink className="text-red-500" style={{ fontSize: 18 }} />
                            {t('session.chat.disconnect')}
                        </div>
                    </Menu.Item>
                ) : null}

                {!sessionActive ? (
                    <Menu.Item key="delete" className="!text-red-500">
                        <div className="flex items-center gap-3">
                            <IconDelete className="text-red-500" style={{ fontSize: 18 }} />
                            {t('session.action.delete')}
                        </div>
                    </Menu.Item>
                ) : null}
            </Menu>
        </div>
    )
}
