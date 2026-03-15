import { logger } from '@/ui/logger'
import { mkdir, readdir, stat } from 'fs/promises'
import { isAbsolute, join } from 'path'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { rpcError } from '../rpcResponses'

interface ListMachineDirectoryRequest {
    path: string
}

interface DirectoryEntry {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

interface ListMachineDirectoryResponse {
    success: boolean
    entries?: DirectoryEntry[]
    error?: string
}

interface CreateMachineDirectoryRequest {
    parentPath: string
    name: string
}

interface CreateMachineDirectoryResponse {
    success: boolean
    path?: string
    error?: string
}

async function pathIsDirectory(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isDirectory()
    } catch {
        return false
    }
}

function validateDirectoryName(name: unknown): string | null {
    if (typeof name !== 'string' || name.length === 0) {
        return 'Directory name must not be empty'
    }

    if (name === '.' || name === '..') {
        return 'Directory name must not be . or ..'
    }

    if (name.includes('/') || name.includes('\\')) {
        return 'Directory name must not contain path separators'
    }

    return null
}

function getMachineDirectoryBrowseError(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code?: string }).code
        if (code === 'EACCES' || code === 'EPERM') {
            return 'Permission denied while listing directory'
        }
        if (code === 'ENOENT') {
            return 'Path must be an existing directory'
        }
        if (code === 'ENOTDIR') {
            return 'Path must be an existing directory'
        }
    }

    return 'Failed to list machine directory'
}

function getMachineDirectoryCreateError(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code?: string }).code
        if (code === 'EEXIST') {
            return 'Directory already exists'
        }
        if (code === 'ENOENT') {
            return 'Parent path must be an existing directory'
        }
        if (code === 'EACCES' || code === 'EPERM') {
            return 'Permission denied while creating directory'
        }
        if (code === 'ENOTDIR') {
            return 'Parent path must be an existing directory'
        }
    }

    return 'Failed to create machine directory'
}

export function registerMachineDirectoryHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<ListMachineDirectoryRequest, ListMachineDirectoryResponse>('listMachineDirectory', async (data) => {
        logger.debug('List machine directory request:', data?.path)

        const targetPath = data?.path
        if (typeof targetPath !== 'string' || !isAbsolute(targetPath)) {
            return rpcError('Path must be absolute')
        }

        if (!await pathIsDirectory(targetPath)) {
            return rpcError('Path must be an existing directory')
        }

        try {
            const entries = await readdir(targetPath, { withFileTypes: true })

            const directoryEntries: DirectoryEntry[] = await Promise.all(
                entries.map(async (entry) => {
                    const fullPath = join(targetPath, entry.name)
                    let type: 'file' | 'directory' | 'other' = 'other'
                    let size: number | undefined
                    let modified: number | undefined

                    if (entry.isDirectory()) {
                        type = 'directory'
                    } else if (entry.isFile()) {
                        type = 'file'
                    } else if (entry.isSymbolicLink()) {
                        type = 'other'
                    }

                    if (!entry.isSymbolicLink()) {
                        try {
                            const stats = await stat(fullPath)
                            size = stats.size
                            modified = stats.mtime.getTime()
                        } catch (error) {
                            logger.debug(`Failed to stat ${fullPath}:`, error)
                        }
                    }

                    return {
                        name: entry.name,
                        type,
                        size,
                        modified
                    }
                })
            )

            directoryEntries.sort((a, b) => {
                if (a.type === 'directory' && b.type !== 'directory') return -1
                if (a.type !== 'directory' && b.type === 'directory') return 1
                return a.name.localeCompare(b.name)
            })

            return { success: true, entries: directoryEntries }
        } catch (error) {
            logger.debug('Failed to list machine directory:', error)
            return rpcError(getMachineDirectoryBrowseError(error))
        }
    })

    rpcHandlerManager.registerHandler<CreateMachineDirectoryRequest, CreateMachineDirectoryResponse>('createMachineDirectory', async (data) => {
        logger.debug('Create machine directory request:', data?.parentPath, data?.name)

        if (typeof data?.parentPath !== 'string' || !isAbsolute(data.parentPath)) {
            return rpcError('Parent path must be absolute')
        }

        const nameError = validateDirectoryName(data?.name)
        if (nameError) {
            return rpcError(nameError)
        }

        if (!await pathIsDirectory(data.parentPath)) {
            return rpcError('Parent path must be an existing directory')
        }

        try {
            const createdPath = join(data.parentPath, data.name)
            await mkdir(createdPath, { recursive: false })
            return { success: true, path: createdPath }
        } catch (error) {
            logger.debug('Failed to create machine directory:', error)
            return rpcError(getMachineDirectoryCreateError(error))
        }
    })
}
