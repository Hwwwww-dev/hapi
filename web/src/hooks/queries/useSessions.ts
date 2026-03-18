import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback, useRef, useEffect } from 'react'
import type { ApiClient } from '@/api/client'
import type { SessionGroup, SessionSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export type SessionGroupState = {
    directory: string
    sessions: SessionSummary[]
    hasMore: boolean
    total: number
    offset: number  // next offset to load (= count of main sessions loaded so far)
}

/** Sort sessions: active first, then by updatedAt descending */
function sortSessions(sessions: SessionSummary[]): SessionSummary[] {
    return sessions.slice().sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1
        return (b.updatedAt || 0) - (a.updatedAt || 0)
    })
}

function mergeGroups(
    existing: Map<string, SessionGroupState>,
    incoming: SessionGroup[],
    isInitial: boolean
): Map<string, SessionGroupState> {
    const next = new Map(existing)

    for (const g of incoming) {
        const prev = next.get(g.directory)

        if (isInitial || !prev) {
            const mainCount = g.sessions.filter(s => !s.metadata?.parentNativeSessionId).length
            next.set(g.directory, {
                directory: g.directory,
                sessions: sortSessions(g.sessions),
                hasMore: g.hasMore,
                total: g.total,
                offset: mainCount,
            })
        } else {
            // Incremental auto-refresh: upsert by id, preserve sort order
            const existingIds = new Set(prev.sessions.map(s => s.id))
            const newSessions = g.sessions.filter(s => !existingIds.has(s.id))
            const updated = prev.sessions.map(s => {
                const fresh = g.sessions.find(f => f.id === s.id)
                return fresh ?? s
            })
            next.set(g.directory, {
                ...prev,
                sessions: sortSessions([...updated, ...newSessions]),
                total: g.total,
            })
        }
    }

    return next
}

export function useSessions(api: ApiClient | null, flavor?: string, active?: boolean): {
    groups: SessionGroupState[]
    sessions: SessionSummary[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
    removeSession: (sessionId: string) => void
    loadMoreForDirectory: (directory: string) => Promise<void>
    isLoadingMoreFor: (directory: string) => boolean
} {
    const [groupMap, setGroupMap] = useState<Map<string, SessionGroupState>>(new Map())
    const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
    const isInitialRef = useRef(true)
    const flavorRef = useRef(flavor)
    const queryClient = useQueryClient()

    // Reset state when flavor or active filter changes
    useEffect(() => {
        flavorRef.current = flavor
        setGroupMap(new Map())
        isInitialRef.current = true
    }, [flavor, active])

    const query = useQuery({
        queryKey: [...queryKeys.sessions, flavor, active],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            // Capture the flavor at request time to detect stale responses
            const requestFlavor = flavorRef.current
            const result = await api.getSessions(flavor, active)
            // Discard response if flavor changed while request was in-flight
            if (flavorRef.current !== requestFlavor) return result
            const isInitial = isInitialRef.current
            isInitialRef.current = false
            setGroupMap(prev => mergeGroups(prev, result.groups, isInitial))
            return result
        },
        enabled: Boolean(api),
        staleTime: 30_000,
        refetchInterval: 60_000,
        refetchOnWindowFocus: true,
    })

    // Sync groupMap when query cache is patched externally (e.g. SSE patchSessionSummary)
    useEffect(() => {
        if (!query.data?.groups) return
        setGroupMap(prev => mergeGroups(prev, query.data.groups, false))
    }, [query.data])

    const loadMoreForDirectory = useCallback(async (directory: string) => {
        if (!api || loadingDirs.has(directory)) return
        const currentGroup = groupMap.get(directory)
        if (!currentGroup?.hasMore) return

        setLoadingDirs(prev => new Set(prev).add(directory))
        try {
            const result = await api.getSessionsForDirectory(directory, currentGroup.offset, flavor)
            const incoming = result.groups.find(g => g.directory === directory)
            if (!incoming) return
            setGroupMap(prev => {
                const prevGroup = prev.get(directory)
                if (!prevGroup) return prev
                const existingIds = new Set(prevGroup.sessions.map(s => s.id))
                const newSessions = incoming.sessions.filter(s => !existingIds.has(s.id))
                const mainCount = incoming.sessions.filter(s => !s.metadata?.parentNativeSessionId).length
                const next = new Map(prev)
                next.set(directory, {
                    ...prevGroup,
                    sessions: [...prevGroup.sessions, ...newSessions],
                    hasMore: incoming.hasMore,
                    total: incoming.total,
                    offset: prevGroup.offset + mainCount,
                })
                return next
            })
        } finally {
            setLoadingDirs(prev => {
                const next = new Set(prev)
                next.delete(directory)
                return next
            })
        }
    }, [api, groupMap, loadingDirs, flavor])

    const removeSession = useCallback((sessionId: string) => {
        setGroupMap(prev => {
            const next = new Map<string, SessionGroupState>()
            for (const [dir, group] of prev) {
                const filtered = group.sessions.filter(s => s.id !== sessionId)
                if (filtered.length !== group.sessions.length) {
                    next.set(dir, { ...group, sessions: filtered, total: group.total - 1 })
                } else {
                    next.set(dir, group)
                }
            }
            return next
        })
    }, [])

    const refetch = useCallback(async () => {
        isInitialRef.current = false
        return queryClient.invalidateQueries({ queryKey: [...queryKeys.sessions, flavor, active] })
    }, [queryClient, flavor, active])

    const groups = Array.from(groupMap.values())
    return {
        groups,
        sessions: groups.flatMap(g => g.sessions),
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load sessions' : null,
        refetch,
        removeSession,
        loadMoreForDirectory,
        isLoadingMoreFor: (dir) => loadingDirs.has(dir),
    }
}
