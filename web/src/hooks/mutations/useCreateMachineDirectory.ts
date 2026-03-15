import { useMutation, useQueryClient } from '@tanstack/react-query'
import { extractApiErrorMessage, type ApiClient } from '@/api/client'
import type { CreateMachineDirectoryResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

type CreateMachineDirectoryInput = {
    machineId: string
    parentPath: string
    name: string
}

export function useCreateMachineDirectory(api: ApiClient | null): {
    createMachineDirectory: (input: CreateMachineDirectoryInput) => Promise<CreateMachineDirectoryResponse>
    isPending: boolean
    error: string | null
} {
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: CreateMachineDirectoryInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }

            return await api.createMachineDirectory(input.machineId, input.parentPath, input.name)
        },
        onSuccess: async (_result, input) => {
            await queryClient.invalidateQueries({
                queryKey: queryKeys.machineDirectory(input.machineId, input.parentPath)
            })
        }
    })

    return {
        createMachineDirectory: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error ? extractApiErrorMessage(mutation.error, 'Failed to create directory') : null
    }
}
