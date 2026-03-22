import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CommitEntry } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useGitLog(api: ApiClient | null, sessionId: string | null, options?: { limit?: number; skip?: number; branch?: string; keyword?: string; author?: string; hash?: string; since?: string; until?: string }) {
    const resolvedSessionId = sessionId ?? ''
    const limit = options?.limit ?? 50
    const skip = options?.skip ?? 0
    const branch = options?.branch
    const keyword = options?.keyword
    const author = options?.author
    const hash = options?.hash
    const since = options?.since
    const until = options?.until

    const query = useQuery({
        queryKey: [...queryKeys.gitLog(resolvedSessionId), limit, skip, branch ?? '', keyword ?? '', author ?? '', hash ?? '', since ?? '', until ?? ''],
        queryFn: async (): Promise<CommitEntry[]> => {
            if (!api || !resolvedSessionId) return []
            const result = await api.gitLog(resolvedSessionId, limit, skip, branch, keyword, since, until, author, hash)
            if (!result.success || !result.data) return []
            return result.data
        },
        enabled: !!api && !!resolvedSessionId
    })

    return {
        commits: query.data ?? [],
        isLoading: query.isLoading,
        error: query.error,
        refetch: query.refetch
    }
}
