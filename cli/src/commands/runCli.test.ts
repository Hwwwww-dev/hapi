import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const runMock = vi.fn(async () => undefined)
const resolveCommandMock = vi.fn(() => ({
    command: {
        name: 'doctor',
        requiresRuntimeAssets: false,
        run: runMock
    },
    context: {
        args: ['doctor'],
        subcommand: 'doctor',
        commandArgs: []
    }
}))

vi.mock('./registry', () => ({
    resolveCommand: resolveCommandMock
}))

vi.mock('@/utils/cliArgs', () => ({
    getCliArgs: () => ['doctor']
}))

vi.mock('@/runtime/assets', () => ({
    ensureRuntimeAssets: vi.fn(async () => undefined)
}))

describe('runCli', () => {
    const originalCwd = process.cwd()
    let tempDir: string

    beforeEach(async () => {
        vi.clearAllMocks()
        tempDir = join(tmpdir(), `run-cli-${Date.now()}`)
        await mkdir(tempDir, { recursive: true })
        process.chdir(originalCwd)
    })

    afterEach(async () => {
        delete process.env.HAPI_CLI_WORKDIR
        process.chdir(originalCwd)
        await rm(tempDir, { recursive: true, force: true })
    })

    it('does not change forwarded dev cli workdir before executing the resolved command', async () => {
        process.env.HAPI_CLI_WORKDIR = tempDir
        let observedCwd = ''
        runMock.mockImplementationOnce(async () => {
            observedCwd = process.cwd()
        })

        const { runCli } = await import('./runCli')
        await runCli()

        expect(resolveCommandMock).toHaveBeenCalled()
        expect(runMock).toHaveBeenCalled()
        expect(observedCwd).toBe(originalCwd)
        expect(process.env.HAPI_CLI_WORKDIR).toBe(tempDir)
    })
})
