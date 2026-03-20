import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CommitEntry } from '@/types/api'
import { parseGitLog } from '@/lib/gitParsers'
import { queryKeys } from '@/lib/query-keys'

export function useGitLog(api: ApiClient | null, sessionId: string | null, options?: { limit?: number; skip?: number; branch?: string }) {
    const resolvedSessionId = sessionId ?? ''
    const limit = options?.limit ?? 50
    const skip = options?.skip ?? 0
    const branch = options?.branch

    const query = useQuery({
        queryKey: [...queryKeys.gitLog(resolvedSessionId), limit, skip, branch ?? ''],
        queryFn: async (): Promise<CommitEntry[]> => {
            if (!api || !resolvedSessionId) return []
            const result = await api.gitLog(resolvedSessionId, limit, skip, branch)
            if (!result.success || !result.stdout) return []
            return parseGitLog(result.stdout)
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
