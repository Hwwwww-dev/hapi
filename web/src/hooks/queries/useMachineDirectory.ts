import { useQuery } from '@tanstack/react-query'
import { extractApiErrorMessage, type ApiClient } from '@/api/client'
import type { DirectoryEntry } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useMachineDirectory(
    api: ApiClient | null,
    machineId: string | null,
    path: string | null,
    options?: { enabled?: boolean }
): {
    entries: DirectoryEntry[]
    error: string | null
    isLoading: boolean
    refetch: () => Promise<unknown>
} {
    const resolvedMachineId = machineId ?? 'unknown'
    const resolvedPath = path ?? ''
    const enabled = Boolean(api && machineId && path) && (options?.enabled ?? true)

    const query = useQuery({
        queryKey: queryKeys.machineDirectory(resolvedMachineId, resolvedPath),
        queryFn: async () => {
            if (!api || !machineId || !path) {
                throw new Error('Machine directory unavailable')
            }

            const response = await api.listMachineDirectory(machineId, path)
            if (!response.success) {
                return { entries: [], error: response.error ?? 'Failed to list machine directory' }
            }

            return { entries: response.entries ?? [], error: null }
        },
        enabled,
    })

    const queryError = query.error
        ? extractApiErrorMessage(query.error, 'Failed to list machine directory')
        : null

    return {
        entries: query.data?.entries ?? [],
        error: queryError ?? query.data?.error ?? null,
        isLoading: query.isLoading,
        refetch: query.refetch
    }
}
