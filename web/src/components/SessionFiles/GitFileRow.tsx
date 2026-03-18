import { useState, useRef, useEffect } from 'react'
import type { GitFileStatus } from '@/types/api'
import { StatusBadge } from './StatusBadge'
import { FileIcon } from '@/components/FileIcon'

function LineChanges({ added, removed }: { added: number; removed: number }) {
    if (!added && !removed) return null
    return (
        <span className="flex items-center gap-1 text-[11px] font-mono">
            {added ? <span className="text-[var(--app-diff-added-text)]">+{added}</span> : null}
            {removed ? <span className="text-[var(--app-diff-removed-text)]">-{removed}</span> : null}
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
    const subtitle = file.filePath || 'project root'

    return (
        <div className={`flex w-full items-center gap-3 px-3 py-2 ${showDivider ? 'border-b border-[var(--app-divider)]' : ''}`}>
            {showCheckbox && (
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle?.(file)}
                    className="shrink-0 w-4 h-4 accent-[var(--app-link)]"
                />
            )}
            <button
                type="button"
                onClick={() => onOpen(file.fullPath, file.isStaged)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left hover:bg-[var(--app-subtle-bg)] transition-colors rounded"
            >
                <FileIcon fileName={file.fileName} size={22} />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{file.fileName}</div>
                    <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
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