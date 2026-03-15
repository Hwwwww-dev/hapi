import { beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { RpcHandlerManager } from '../../../api/rpc/RpcHandlerManager'
import { registerMachineDirectoryHandlers } from './machineDirectories'

async function createTempDir(prefix: string): Promise<string> {
    const base = tmpdir()
    const path = join(base, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

describe('machine directory RPC handlers', () => {
    let rootDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        if (rootDir) {
            await rm(rootDir, { recursive: true, force: true })
        }

        rootDir = await createTempDir('hapi-machine-dir-handler')
        await mkdir(join(rootDir, 'alpha'), { recursive: true })
        await writeFile(join(rootDir, 'zeta.txt'), 'z')
        await writeFile(join(rootDir, 'parent-file.txt'), 'not a directory')

        rpc = new RpcHandlerManager({ scopePrefix: 'machine-test' })
        registerMachineDirectoryHandlers(rpc)
    })

    it('lists an absolute machine directory', async () => {
        const response = await rpc.handleRequest({
            method: 'machine-test:listMachineDirectory',
            params: JSON.stringify({ path: rootDir })
        })

        const parsed = JSON.parse(response) as { success: boolean; entries?: Array<{ name: string; type: string }>; error?: string }
        expect(parsed).toMatchObject({ success: true })
        expect(parsed.entries?.map((entry) => entry.name)).toEqual(['alpha', 'parent-file.txt', 'zeta.txt'])
        expect(parsed.entries?.[0]).toMatchObject({ name: 'alpha', type: 'directory' })
    })

    it('rejects relative paths when listing machine directories', async () => {
        const response = await rpc.handleRequest({
            method: 'machine-test:listMachineDirectory',
            params: JSON.stringify({ path: 'relative/path' })
        })

        const parsed = JSON.parse(response) as { success: boolean; error?: string }
        expect(parsed).toEqual({ success: false, error: 'Path must be absolute' })
    })

    it('creates a direct child directory under an absolute parent path', async () => {
        const response = await rpc.handleRequest({
            method: 'machine-test:createMachineDirectory',
            params: JSON.stringify({ parentPath: rootDir, name: 'new-child' })
        })

        const parsed = JSON.parse(response) as { success: boolean; path?: string; error?: string }
        expect(parsed).toEqual({ success: true, path: join(rootDir, 'new-child') })

        const listResponse = await rpc.handleRequest({
            method: 'machine-test:listMachineDirectory',
            params: JSON.stringify({ path: rootDir })
        })
        const listed = JSON.parse(listResponse) as { success: boolean; entries?: Array<{ name: string; type: string }> }
        expect(listed.entries?.some((entry) => entry.name === 'new-child' && entry.type === 'directory')).toBe(true)
    })

    it('rejects invalid child names for machine directory creation', async () => {
        const cases = ['nested/path', 'nested\\path', '.', '..', '']

        for (const name of cases) {
            const response = await rpc.handleRequest({
                method: 'machine-test:createMachineDirectory',
                params: JSON.stringify({ parentPath: rootDir, name })
            })

            const parsed = JSON.parse(response) as { success: boolean; error?: string }
            expect(parsed.success).toBe(false)
        }
    })

    it('requires an existing directory parent and does not create missing ancestors', async () => {
        const missingParent = join(rootDir, 'missing-parent')

        const missingParentResponse = await rpc.handleRequest({
            method: 'machine-test:createMachineDirectory',
            params: JSON.stringify({ parentPath: missingParent, name: 'child' })
        })
        const missingParentParsed = JSON.parse(missingParentResponse) as { success: boolean; error?: string }
        expect(missingParentParsed).toEqual({ success: false, error: 'Parent path must be an existing directory' })

        const fileParentResponse = await rpc.handleRequest({
            method: 'machine-test:createMachineDirectory',
            params: JSON.stringify({ parentPath: join(rootDir, 'parent-file.txt'), name: 'child' })
        })
        const fileParentParsed = JSON.parse(fileParentResponse) as { success: boolean; error?: string }
        expect(fileParentParsed).toEqual({ success: false, error: 'Parent path must be an existing directory' })
    })

    it('rejects creating a directory that already exists', async () => {
        const response = await rpc.handleRequest({
            method: 'machine-test:createMachineDirectory',
            params: JSON.stringify({ parentPath: rootDir, name: 'alpha' })
        })

        const parsed = JSON.parse(response) as { success: boolean; error?: string }
        expect(parsed).toEqual({ success: false, error: 'Directory already exists' })
    })
})
