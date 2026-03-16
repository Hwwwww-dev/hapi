import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

type EventHandler = (...args: any[]) => void

const harness = vi.hoisted(() => {
    const listeners = new Map<string, EventHandler[]>()
    const emits: Array<{ event: string; payload: unknown }> = []

    const socket = {
        on(event: string, handler: EventHandler) {
            const handlers = listeners.get(event) ?? []
            handlers.push(handler)
            listeners.set(event, handlers)
        },
        emit(event: string, payload?: unknown) {
            emits.push({ event, payload })
            return socket
        },
        volatile: {
            emit(event: string, payload?: unknown) {
                emits.push({ event, payload })
                return socket
            }
        },
        connect() {
            return socket
        },
        close() {
            return socket
        }
    }

    return {
        socket,
        emits,
        listeners,
        trigger(event: string, ...args: unknown[]) {
            const handlers = listeners.get(event) ?? []
            for (const handler of handlers) {
                handler(...args)
            }
        },
        reset() {
            emits.length = 0
            listeners.clear()
        }
    }
})

vi.mock('socket.io-client', () => ({
    io: () => harness.socket
}))

vi.mock('@/configuration', () => ({
    configuration: {
        apiUrl: 'http://localhost:3006',
        logsDir: '/tmp',
        isRunnerProcess: false
    }
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

vi.mock('@/terminal/TerminalManager', () => ({
    TerminalManager: class {
        closeAll() {}
        create() {}
        write() {}
        resize() {}
        close() {}
    }
}))

vi.mock('@/modules/common/registerCommonHandlers', () => ({
    registerCommonHandlers: vi.fn()
}))

import { ApiSessionClient } from './apiSession'

describe('ApiSessionClient keepAlive reconnect state', () => {
    beforeEach(() => {
        harness.reset()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('re-emits the latest thinking state after reconnect instead of forcing thinking=false', () => {
        const client = new ApiSessionClient('token', {
            id: 'session-1',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadata: null,
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 0
        })

        client.keepAlive(true, 'remote', { permissionMode: 'default' })
        harness.emits.length = 0

        harness.trigger('connect')

        expect(harness.emits).toContainEqual({
            event: 'session-alive',
            payload: expect.objectContaining({
                sid: 'session-1',
                thinking: true,
                mode: 'remote',
                permissionMode: 'default'
            })
        })
    })
})
