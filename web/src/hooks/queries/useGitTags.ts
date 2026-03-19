import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { parseTagList } from '@/lib/gitParsers'

export function useGitTags(api: ApiClient, sessionId: string) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['git-tags', sessionId],
        queryFn: async () => {
            const res = await api.gitTagList(sessionId)
            if (!res.success) throw new Error(res.error ?? 'Failed to fetch tags')
            return parseTagList(res.stdout ?? '')
        }
    })
    return { tags: data ?? [], isLoading, error, refetch }
}
