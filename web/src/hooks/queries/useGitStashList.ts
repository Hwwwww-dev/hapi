import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { StashEntry } from '@/types/api'
import { parseStashList } from '@/lib/gitParsers'
import { queryKeys } from '@/lib/query-keys'

export function useGitStashList(api: ApiClient | null, sessionId: string | null) {
    const resolvedSessionId = sessionId ?? ''

    const query = useQuery({
        queryKey: queryKeys.gitStashList(resolvedSessionId),
        queryFn: async (): Promise<StashEntry[]> => {
            if (!api || !resolvedSessionId) return []
            const result = await api.gitStashList(resolvedSessionId)
            if (!result.success || !result.stdout) return []
            return parseStashList(result.stdout)
        },
        enabled: !!api && !!resolvedSessionId
    })

    return {
        stashes: query.data ?? [],
        isLoading: query.isLoading,
        error: query.error,
        refetch: query.refetch
    }
}
