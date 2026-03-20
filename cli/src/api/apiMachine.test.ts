import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
    registerCommonHandlers: vi.fn(),
    registerMachineDirectoryHandlers: vi.fn()
}))

vi.mock('socket.io-client', () => ({
    io: () => ({
        on: vi.fn(),
        emit: vi.fn(),
        emitWithAck: vi.fn(),
        volatile: { emit: vi.fn() },
        connect: vi.fn(),
        close: vi.fn()
    })
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

vi.mock('@/configuration', () => ({
    configuration: {
        apiUrl: 'http://localhost:3006'
    }
}))

vi.mock('../modules/common/registerCommonHandlers', () => ({
    registerCommonHandlers: harness.registerCommonHandlers
}))

vi.mock('../modules/common/handlers/machineDirectories', () => ({
    registerMachineDirectoryHandlers: harness.registerMachineDirectoryHandlers
}))

import { ApiMachineClient } from './apiMachine'

describe('ApiMachineClient', () => {
    const originalEnv = process.env.HAPI_CLI_WORKDIR

    beforeEach(() => {
        harness.registerCommonHandlers.mockReset()
        harness.registerMachineDirectoryHandlers.mockReset()
    })

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.HAPI_CLI_WORKDIR
        } else {
            process.env.HAPI_CLI_WORKDIR = originalEnv
        }
    })

    it('registers common handlers with the forwarded logical cwd when present', () => {
        process.env.HAPI_CLI_WORKDIR = '/tmp/forwarded-project'

        new ApiMachineClient('token', {
            id: 'machine-1',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadata: null,
            metadataVersion: 1,
            runnerState: null,
            runnerStateVersion: 1
        })

        expect(harness.registerCommonHandlers).toHaveBeenCalledWith(
            expect.anything(),
            '/tmp/forwarded-project'
        )
    })
})
