import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import type { ApiClient } from '@/api/client'
import type { GitStatusFiles } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useGitStatusFiles(api: ApiClient | null, sessionId: string | null): {
    status: GitStatusFiles | null
    error: string | null
    isLoading: boolean
    refetch: () => Promise<unknown>
} {
    const queryClient = useQueryClient()
    const resolvedSessionId = sessionId ?? 'unknown'
    const [isRefreshing, setIsRefreshing] = useState(false)

    const query = useQuery({
        queryKey: queryKeys.gitStatus(resolvedSessionId),
        queryFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }

            const result = await api.getGitStatusFiles(sessionId)
            if (!result.success) {
                return {
                    status: null,
                    error: result.error ?? 'Git status unavailable'
                }
            }

            return { status: result.data ?? null, error: null }
        },
        enabled: Boolean(api && sessionId),
    })

    const queryError = query.error instanceof Error
        ? query.error.message
        : query.error
            ? 'Git status unavailable'
            : null

    const refetch = useCallback(async () => {
        setIsRefreshing(true)
        const minDelay = new Promise<void>(r => setTimeout(r, 500))
        try {
            await Promise.all([
                queryClient.refetchQueries({ queryKey: queryKeys.gitStatus(resolvedSessionId) }),
                minDelay,
            ])
        } finally {
            setIsRefreshing(false)
        }
    }, [queryClient, resolvedSessionId])

    return {
        status: query.data?.status ?? null,
        error: queryError ?? query.data?.error ?? null,
        isLoading: query.isLoading || isRefreshing,
        refetch,
    }
}
