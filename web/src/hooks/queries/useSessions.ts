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
                sessions: g.sessions,
                hasMore: g.hasMore,
                total: g.total,
                offset: mainCount,
            })
        } else {
            // Incremental auto-refresh: upsert by id, don't replace
            const existingIds = new Set(prev.sessions.map(s => s.id))
            const newSessions = g.sessions.filter(s => !existingIds.has(s.id))
            const updated = prev.sessions.map(s => {
                const fresh = g.sessions.find(f => f.id === s.id)
                return fresh ?? s
            })
            next.set(g.directory, {
                ...prev,
                sessions: [...updated, ...newSessions],
                total: g.total,
            })
        }
    }

    return next
}

export function useSessions(api: ApiClient | null, flavor?: string): {
    groups: SessionGroupState[]
    sessions: SessionSummary[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
    loadMoreForDirectory: (directory: string) => Promise<void>
    isLoadingMoreFor: (directory: string) => boolean
} {
    const [groupMap, setGroupMap] = useState<Map<string, SessionGroupState>>(new Map())
    const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
    const isInitialRef = useRef(true)
    const queryClient = useQueryClient()

    // Reset state when flavor changes
    useEffect(() => {
        setGroupMap(new Map())
        isInitialRef.current = true
    }, [flavor])

    const query = useQuery({
        queryKey: [...queryKeys.sessions, flavor],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            const result = await api.getSessions(flavor)
            const isInitial = isInitialRef.current
            isInitialRef.current = false
            setGroupMap(prev => mergeGroups(prev, result.groups, isInitial))
            return result
        },
        enabled: Boolean(api),
        refetchInterval: 5000,
    })

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

    const refetch = useCallback(async () => {
        isInitialRef.current = false
        return queryClient.invalidateQueries({ queryKey: [...queryKeys.sessions, flavor] })
    }, [queryClient, flavor])

    const groups = Array.from(groupMap.values())
    return {
        groups,
        sessions: groups.flatMap(g => g.sessions),
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load sessions' : null,
        refetch,
        loadMoreForDirectory,
        isLoadingMoreFor: (dir) => loadingDirs.has(dir),
    }
}
