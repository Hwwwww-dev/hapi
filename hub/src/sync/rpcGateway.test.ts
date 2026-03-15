import { describe, expect, it } from 'bun:test'
import { RpcGateway } from './rpcGateway'

describe('RpcGateway', () => {
    it('disables implicit directory creation for spawned machine sessions', async () => {
        const calls: Array<{ method: string; params: string }> = []

        const socket = {
            timeout: () => ({
                emitWithAck: async (_event: string, payload: { method: string; params: string }) => {
                    calls.push(payload)
                    return JSON.stringify({ type: 'success', sessionId: 'session-1' })
                }
            })
        }

        const io = {
            of: () => ({
                sockets: new Map([['socket-1', socket]])
            })
        }

        const rpcRegistry = {
            getSocketIdForMethod: (method: string) => method === 'machine-1:spawn-happy-session' ? 'socket-1' : null
        }

        const gateway = new RpcGateway(io as never, rpcRegistry as never)
        const result = await gateway.spawnSession('machine-1', '/tmp/project')

        expect(result).toEqual({ type: 'success', sessionId: 'session-1' })

        expect(calls).toHaveLength(1)
        expect(calls[0]?.method).toBe('machine-1:spawn-happy-session')

        const params = JSON.parse(calls[0]!.params) as Record<string, unknown>
        expect(params.directory).toBe('/tmp/project')
        expect(params.approvedNewDirectoryCreation).toBe(false)
    })
})
