import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'

export function useGitRemotes(api: ApiClient, sessionId: string) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['git-remotes', sessionId],
        queryFn: async () => {
            const res = await api.gitRemoteList(sessionId)
            if (!res.success) throw new Error(res.error ?? 'Failed to fetch remotes')
            return res.data ?? []
        }
    })
    return { remotes: data ?? [], isLoading, error, refetch }
}
