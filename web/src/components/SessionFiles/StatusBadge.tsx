import { useMemo } from 'react'
import type { GitFileStatus } from '@/types/api'

export function StatusBadge({ status }: { status: GitFileStatus['status'] }) {
    const { label, color } = useMemo(() => {
        switch (status) {
            case 'added':
                return { label: 'A', color: 'var(--app-git-staged-color)' }
            case 'deleted':
                return { label: 'D', color: 'var(--app-git-deleted-color)' }
            case 'renamed':
                return { label: 'R', color: 'var(--app-git-renamed-color)' }
            case 'untracked':
                return { label: '?', color: 'var(--app-git-untracked-color)' }
            case 'conflicted':
                return { label: 'U', color: 'var(--app-git-deleted-color)' }
            default:
                return { label: 'M', color: 'var(--app-git-unstaged-color)' }
        }
    }, [status])

    return (
        <span
            className="inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[length:var(--text-badge)] font-semibold"
            style={{ color, borderColor: color }}
        >
            {label}
        </span>
    )
}
