import { useCallback, useState } from 'react'

const STORAGE_KEY_PREFIX = 'hapi:dir-expanded:'

function loadExpanded(sessionId: string): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_PREFIX + sessionId)
        if (!raw) return ['']
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) return parsed as string[]
    } catch {
        // ignore
    }
    return ['']
}

function saveExpanded(sessionId: string, paths: string[]) {
    try {
        localStorage.setItem(STORAGE_KEY_PREFIX + sessionId, JSON.stringify(paths))
    } catch {
        // ignore
    }
}

export function useDirectoryExpanded(sessionId: string) {
    const [expanded, setExpanded] = useState<string[]>(() => loadExpanded(sessionId))

    const handleExpandedChange = useCallback((paths: string[]) => {
        // always keep root '' in the set
        const next = paths.includes('') ? paths : ['', ...paths]
        setExpanded(next)
        saveExpanded(sessionId, next)
    }, [sessionId])

    return { expanded, handleExpandedChange }
}
