import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

type EventHandler = (...args: any[]) => void

function createHarness() {
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
        async emitWithAck(event: string, payload?: any) {
            emits.push({ event, payload })
            if (event === 'update-metadata') {
                return {
                    result: 'success',
                    version: 2,
                    metadata: payload?.metadata ?? null
                }
            }
            if (event === 'update-state') {
                return {
                    result: 'success',
                    version: 2,
                    agentState: payload?.agentState ?? null
                }
            }
            return { result: 'success' }
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
}

const harness = createHarness()
;
(globalThis as typeof globalThis & { __apiSessionHarness?: ReturnType<typeof createHarness> }).__apiSessionHarness = harness

vi.mock('socket.io-client', () => ({
    io: () => (globalThis as typeof globalThis & { __apiSessionHarness: ReturnType<typeof createHarness> }).__apiSessionHarness.socket
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

function createSession(overrides?: Partial<ConstructorParameters<typeof ApiSessionClient>[1]>) {
    return {
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
        thinkingAt: 0,
        ...overrides
    }
}

describe('ApiSessionClient keepAlive reconnect state', () => {
    beforeEach(() => {
        harness.reset()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('re-emits the latest thinking state after reconnect instead of forcing thinking=false', () => {
        const client = new ApiSessionClient('token', createSession())

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

    it('emits Claude runtime raw events with uuid-based identity instead of legacy socket messages', () => {
        const client = new ApiSessionClient('token', createSession({
            metadata: {
                path: '/tmp/project',
                host: 'local',
                claudeSessionId: 'claude-native-1',
                flavor: 'claude'
            }
        }))

        client.sendClaudeSessionMessage({
            type: 'user',
            uuid: 'user-1',
            sessionId: 'claude-native-1',
            message: {
                role: 'user',
                content: 'hello runtime'
            }
        } as any)

        expect(harness.emits).not.toContainEqual(expect.objectContaining({
            event: 'message'
        }))
        expect(harness.emits).toContainEqual({
            event: 'runtime-event',
            payload: expect.objectContaining({
                sid: 'session-1',
                event: expect.objectContaining({
                    provider: 'claude',
                    source: 'runtime',
                    sourceSessionId: 'claude-native-1',
                    sourceKey: 'uuid:user-1',
                    observationKey: 'claude:uuid:user-1',
                    channel: 'claude:runtime:messages',
                    sourceOrder: 0,
                    rawType: 'user',
                    payload: expect.objectContaining({
                        type: 'user',
                        uuid: 'user-1'
                    })
                })
            })
        })
    })

    it.each([
        ['codex', 'codexSessionId', 'codex-thread-1'],
        ['gemini', 'geminiSessionId', 'gemini-session-1'],
        ['cursor', 'cursorSessionId', 'cursor-session-1'],
        ['opencode', 'opencodeSessionId', 'opencode-session-1']
    ] as const)('emits %s runtime raw events with preserved flavor and fallback source keys', (flavor, sessionField, sourceSessionId) => {
        const client = new ApiSessionClient('token', createSession({
            metadata: {
                path: '/tmp/project',
                host: 'local',
                flavor,
                [sessionField]: sourceSessionId
            }
        }))

        client.sendCodexMessage({
            type: 'tool-call',
            name: 'Read',
            callId: 'call-1',
            input: { path: 'README.md' }
        })
        client.sendCodexMessage({
            type: 'message',
            message: 'done'
        })

        const runtimeEvents = harness.emits.filter((entry) => entry.event === 'runtime-event')
        expect(runtimeEvents).toHaveLength(2)
        expect(runtimeEvents[0]).toEqual({
            event: 'runtime-event',
            payload: expect.objectContaining({
                sid: 'session-1',
                event: expect.objectContaining({
                    provider: flavor,
                    source: 'runtime',
                    sourceSessionId,
                    sourceKey: 'call_id:call-1',
                    observationKey: `${flavor}:call_id:call-1`,
                    channel: `${flavor}:runtime`,
                    sourceOrder: 0,
                    rawType: 'tool-call',
                    payload: expect.objectContaining({
                        type: 'tool-call',
                        callId: 'call-1'
                    })
                })
            })
        })
        expect(runtimeEvents[1]).toEqual({
            event: 'runtime-event',
            payload: expect.objectContaining({
                sid: 'session-1',
                event: expect.objectContaining({
                    provider: flavor,
                    source: 'runtime',
                    sourceSessionId,
                    sourceKey: 'runtime:1:message',
                    observationKey: null,
                    channel: `${flavor}:runtime`,
                    sourceOrder: 1,
                    rawType: 'message',
                    payload: expect.objectContaining({
                        type: 'message',
                        message: 'done'
                    })
                })
            })
        })
    })

    it('stores MCP generated titles in metadata.summary with generated source while sending runtime-event', async () => {
        const client = new ApiSessionClient('token', createSession({
            id: 'session-2',
            metadata: {
                path: '/tmp/project',
                host: 'local',
                claudeSessionId: 'claude-native-2',
                flavor: 'claude'
            }
        }))

        client.sendClaudeSessionMessage({
            type: 'summary',
            summary: 'Generated Title',
            leafUuid: 'leaf-1'
        } as any)

        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(harness.emits).toContainEqual({
            event: 'runtime-event',
            payload: expect.objectContaining({
                sid: 'session-2',
                event: expect.objectContaining({
                    provider: 'claude',
                    sourceSessionId: 'claude-native-2',
                    sourceKey: 'leafUuid:leaf-1',
                    rawType: 'summary',
                    payload: expect.objectContaining({
                        type: 'summary',
                        leafUuid: 'leaf-1'
                    })
                })
            })
        })
        expect(harness.emits).toContainEqual({
            event: 'update-metadata',
            payload: expect.objectContaining({
                sid: 'session-2',
                metadata: expect.objectContaining({
                    summary: expect.objectContaining({
                        text: 'Generated Title',
                        source: 'generated'
                    })
                })
            })
        })
    })
})
