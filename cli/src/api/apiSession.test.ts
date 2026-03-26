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

import { ApiSessionClient, isExternalUserMessage } from './apiSession'

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

    it('stores MCP generated titles in metadata.summary with generated source', async () => {
        const client = new ApiSessionClient('token', {
            id: 'session-2',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadata: {
                path: '/tmp/project',
                host: 'local'
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 0
        })

        client.sendClaudeSessionMessage({
            type: 'summary',
            summary: 'Generated Title',
            leafUuid: 'leaf-1'
        } as any)

        await new Promise((resolve) => setTimeout(resolve, 0))

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

describe('isExternalUserMessage', () => {
    const baseUserMsg = {
        type: 'user' as const,
        uuid: 'test-uuid',
        userType: 'external' as const,
        isSidechain: false,
        message: { role: 'user', content: 'hello' },
    }

    it('returns true for a real user text message', () => {
        expect(isExternalUserMessage(baseUserMsg)).toBe(true)
    })

    it('returns false when isMeta is true (skill injections)', () => {
        expect(isExternalUserMessage({ ...baseUserMsg, isMeta: true })).toBe(false)
    })

    it('returns false when isSidechain is true', () => {
        expect(isExternalUserMessage({ ...baseUserMsg, isSidechain: true })).toBe(false)
    })

    it('returns false when content is an array (tool results)', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'y' }] },
            } as never)
        ).toBe(false)
    })

    it('returns false for assistant messages', () => {
        expect(
            isExternalUserMessage({
                type: 'assistant',
                uuid: 'test-uuid',
                message: { role: 'assistant', content: 'hi' },
            } as never)
        ).toBe(false)
    })

    // System-injected content detection
    it('returns false for <task-notification> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<task-notification>\n<task-id>abc123</task-id>\n</task-notification>' },
            })
        ).toBe(false)
    })

    it('returns false for <command-name> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<command-name>/clear</command-name>' },
            })
        ).toBe(false)
    })

    it('returns false for <local-command-caveat> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<local-command-caveat>Caveat: ...</local-command-caveat>' },
            })
        ).toBe(false)
    })

    it('returns false for <system-reminder> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<system-reminder>\nToday is 2026.\n</system-reminder>' },
            })
        ).toBe(false)
    })

    it('returns true for user text that mentions XML-like strings but is not injected', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: 'How do I use the <task-notification> tag?' },
            })
        ).toBe(true)
    })

    it('returns false for <task-notification> with leading whitespace', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '  \n<task-notification>\n<task-id>x</task-id>\n</task-notification>' },
            })
        ).toBe(false)
    })
})
