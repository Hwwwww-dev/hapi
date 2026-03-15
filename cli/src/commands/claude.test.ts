import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const runClaudeMock = vi.fn(async () => undefined)

vi.mock('@/claude/runClaude', () => ({
    runClaude: runClaudeMock
}))

vi.mock('@/ui/tokenInit', () => ({
    initializeToken: vi.fn(async () => undefined)
}))

vi.mock('@/utils/autoStartServer', () => ({
    maybeAutoStartServer: vi.fn(async () => undefined)
}))

vi.mock('@/ui/auth', () => ({
    authAndSetupMachineIfNeeded: vi.fn(async () => ({ machineId: 'machine-1' }))
}))

vi.mock('@/runner/controlClient', () => ({
    isRunnerRunningCurrentlyInstalledHappyVersion: vi.fn(async () => true)
}))

describe('claudeCommand', () => {
    const originalCwd = process.cwd()
    let tempDir: string

    beforeEach(async () => {
        vi.clearAllMocks()
        tempDir = join(tmpdir(), `claude-command-${Date.now()}`)
        await mkdir(tempDir, { recursive: true })
        process.chdir(originalCwd)
    })

    afterEach(async () => {
        delete process.env.HAPI_CLI_WORKDIR
        process.chdir(originalCwd)
        await rm(tempDir, { recursive: true, force: true })
    })

    it('applies the forwarded workdir after importing runClaude', async () => {
        process.env.HAPI_CLI_WORKDIR = tempDir
        let observedCwd = ''
        runClaudeMock.mockImplementationOnce(async () => {
            observedCwd = process.cwd()
        })

        const { claudeCommand } = await import('./claude')
        await claudeCommand.run({
            args: ['claude', '--started-by', 'runner'],
            subcommand: 'claude',
            commandArgs: ['--started-by', 'runner']
        })

        expect(runClaudeMock).toHaveBeenCalledWith(expect.objectContaining({
            startedBy: 'runner'
        }))
        expect(observedCwd).toBe(tempDir)
        expect(process.env.HAPI_CLI_WORKDIR).toBeUndefined()
    })
})
