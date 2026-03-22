import { useState, useRef, useEffect } from 'react'
import type { GitFileStatus } from '@/types/api'
import { StatusBadge } from './StatusBadge'
import { FileIcon } from '@/components/FileIcon'
import { useTranslation } from '@/lib/use-translation'
import { Checkbox } from '@arco-design/web-react'

function LineChanges({ added, removed }: { added: number; removed: number }) {
    if (!added && !removed) return null
    return (
        <span className="flex items-center gap-1 text-[length:var(--text-caption)] font-mono">
            {added ? <span className="text-green-500">+{added}</span> : null}
            {removed ? <span className="text-red-500">-{removed}</span> : null}
        </span>
    )
}

export type FileAction = {
    label: string
    onClick: () => void
    destructive?: boolean
}

type GitFileRowProps = {
    file: GitFileStatus
    onOpen: (path: string, staged?: boolean) => void
    actions?: FileAction[]
    showCheckbox?: boolean
    checked?: boolean
    onToggle?: (file: GitFileStatus) => void
    showDivider?: boolean
}

function FileActionMenu({ actions }: { actions: FileAction[] }) {
    const [open, setOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

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
                onClick={() => setOpen(!open)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
            >
                ⋯
            </button>
            {open && (
                <div className="animate-fade-in-scale absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1 shadow-lg">
                    {actions.map((action) => (
                        <button
                            key={action.label}
                            type="button"
                            onClick={() => { setOpen(false); action.onClick() }}
                            className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--app-subtle-bg)] ${action.destructive ? 'text-red-500' : 'text-[var(--app-fg)]'}`}
                        >
                            {action.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

export function GitFileRow({ file, onOpen, actions, showCheckbox, checked, onToggle, showDivider }: GitFileRowProps) {
    const { t } = useTranslation()
    const subtitle = file.filePath || t('git.projectRoot')

    return (
        <div className={`flex w-full items-center gap-2 px-3 py-1 ${showDivider ? 'border-b border-[var(--app-divider)]' : ''}`}>
            {showCheckbox && (
                <Checkbox
                    checked={checked}
                    onChange={() => onToggle?.(file)}
                    className="shrink-0"
                />
            )}
            <button
                type="button"
                onClick={() => onOpen(file.fullPath, file.isStaged)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:bg-[var(--app-subtle-bg)] transition-colors rounded-md px-1.5 py-1"
            >
                <FileIcon fileName={file.fileName} size={18} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{file.fileName}</div>
                    <div className="truncate text-[length:var(--text-caption)] text-[var(--app-hint)]">{subtitle}</div>
                </div>
                <div className="flex items-center gap-2">
                    <LineChanges added={file.linesAdded} removed={file.linesRemoved} />
                    <StatusBadge status={file.status} />
                </div>
            </button>
            {actions && actions.length > 0 && <FileActionMenu actions={actions} />}
        </div>
    )
}