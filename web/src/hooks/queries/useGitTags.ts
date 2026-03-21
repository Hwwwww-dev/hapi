import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'

export function useGitTags(api: ApiClient, sessionId: string, keyword?: string) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['git-tags', sessionId, keyword ?? ''],
        queryFn: async () => {
            const res = await api.gitTagList(sessionId, keyword)
            if (!res.success) throw new Error(res.error ?? 'Failed to fetch tags')
            return res.data ?? []
        }
    })
    return { tags: data ?? [], isLoading, error, refetch }
}
