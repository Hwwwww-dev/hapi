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

type GitFileRowProps = {
    file: GitFileStatus
    onOpen: (path: string, staged?: boolean) => void
    onRollback?: (path: string) => void
    showCheckbox?: boolean
    checked?: boolean
    onToggle?: (file: GitFileStatus) => void
    showDivider?: boolean
}

export function GitFileRow({ file, onOpen, onRollback, showCheckbox, checked, onToggle, showDivider }: GitFileRowProps) {
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
            {onRollback && (
                <button
                    type="button"
                    onClick={() => onRollback(file.fullPath)}
                    className="shrink-0 text-xs px-2 py-0.5 rounded border border-[var(--app-border)] text-red-500 hover:bg-red-500/10 transition-colors"
                    title="Rollback file"
                >
                    Rollback
                </button>
            )}
        </div>
    )
}
