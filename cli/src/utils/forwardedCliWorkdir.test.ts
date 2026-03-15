import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { applyForwardedCliWorkdir } from './forwardedCliWorkdir'

describe('applyForwardedCliWorkdir', () => {
    const originalCwd = process.cwd()
    let tempDir: string

    beforeEach(async () => {
        tempDir = join(tmpdir(), `forwarded-cli-workdir-${Date.now()}`)
        await mkdir(tempDir, { recursive: true })
        process.chdir(originalCwd)
    })

    afterEach(async () => {
        delete process.env.HAPI_CLI_WORKDIR
        process.chdir(originalCwd)
        await rm(tempDir, { recursive: true, force: true })
    })

    it('changes into the forwarded workdir and clears the env flag', () => {
        process.env.HAPI_CLI_WORKDIR = tempDir

        applyForwardedCliWorkdir()

        expect(process.cwd()).toBe(tempDir)
        expect(process.env.HAPI_CLI_WORKDIR).toBeUndefined()
    })
})
