import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GitBranchEntry } from '@/types/api'
import { parseBranchList } from '@/lib/gitParsers'
import { queryKeys } from '@/lib/query-keys'

export function useGitBranches(api: ApiClient | null, sessionId: string | null, currentBranch: string | null) {
    const resolvedSessionId = sessionId ?? ''

    const query = useQuery({
        queryKey: queryKeys.gitBranches(resolvedSessionId),
        queryFn: async (): Promise<{ local: GitBranchEntry[]; remote: GitBranchEntry[] }> => {
            if (!api || !resolvedSessionId) return { local: [], remote: [] }
            const [localResult, remoteResult] = await Promise.all([
                api.getGitBranches(resolvedSessionId),
                api.gitRemoteBranches(resolvedSessionId)
            ])
            const local = localResult.success && localResult.stdout
                ? parseBranchList(localResult.stdout, false, currentBranch)
                : []
            const remote = remoteResult.success && remoteResult.stdout
                ? parseBranchList(remoteResult.stdout, true, currentBranch)
                : []
            return { local, remote }
        },
        enabled: !!api && !!resolvedSessionId
    })

    return {
        local: query.data?.local ?? [],
        remote: query.data?.remote ?? [],
        isLoading: query.isLoading,
        error: query.error,
        refetch: query.refetch
    }
}
