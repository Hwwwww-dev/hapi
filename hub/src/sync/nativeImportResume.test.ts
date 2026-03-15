import { describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'

import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SSEManager } from '../sse/sseManager'
import { SyncEngine } from './syncEngine'
import { VisibilityTracker } from '../visibility/visibilityTracker'

function createEngine() {
    const store = new Store(':memory:')
    const io = {
        of: () => ({
            to: () => ({
                emit: () => undefined
            })
        })
    } as unknown as Server
    const rpcRegistry = new RpcRegistry()
    const sseManager = new SSEManager(0, new VisibilityTracker())
    const engine = new SyncEngine(store, io, rpcRegistry, sseManager)

    return { store, engine, sseManager }
}

describe('native import resume takeover', () => {
    it('suppresses native re-import while a hybrid session is active', () => {
        const { engine, sseManager } = createEngine()
        const namespace = 'default'

        engine.getOrCreateMachine('machine-1', {
            host: 'local',
            platform: 'linux',
            happyCliVersion: '0.1.0'
        }, null, namespace)
        engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

        const imported = engine.upsertNativeSession({
            tag: 'native:claude:project:native-active',
            namespace,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                flavor: 'claude',
                machineId: 'machine-1',
                source: 'native',
                nativeProvider: 'claude',
                nativeSessionId: 'native-active',
                nativeProjectPath: '/tmp/project',
                nativeDiscoveredAt: 1,
                claudeSessionId: 'native-active'
            },
            agentState: null
        })

        engine.handleSessionAlive({ sid: imported.id, time: Date.now(), thinking: true })

        const result = engine.importNativeMessages(imported.id, [{
            content: { role: 'assistant', content: 'native-tail' },
            createdAt: 1,
            sourceProvider: 'claude',
            sourceSessionId: 'native-active',
            sourceKey: 'line:1'
        }])

        expect(result.imported).toBe(0)
        expect(engine.getSession(imported.id)?.metadata).toEqual(expect.objectContaining({
            source: 'hybrid'
        }))
        expect(engine.getMessagesAfter(imported.id, { afterSeq: 0, limit: 10 })).toEqual([])

        engine.stop()
        sseManager.stop()
    })

    it('merges resumed HAPI session back into the imported canonical thread and marks it hybrid', async () => {
        const { store, engine, sseManager } = createEngine()
        const namespace = 'default'

        engine.getOrCreateMachine('machine-1', {
            host: 'local',
            platform: 'linux',
            happyCliVersion: '0.1.0'
        }, null, namespace)
        engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

        const imported = engine.upsertNativeSession({
            tag: 'native:claude:project:native-1',
            namespace,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                flavor: 'claude',
                machineId: 'machine-1',
                source: 'native',
                nativeProvider: 'claude',
                nativeSessionId: 'native-1',
                nativeProjectPath: '/tmp/project',
                nativeDiscoveredAt: 1,
                claudeSessionId: 'native-1'
            },
            agentState: null
        })

        engine.importNativeMessages(imported.id, [{
            content: { role: 'assistant', content: 'native-history' },
            createdAt: 1,
            sourceProvider: 'claude',
            sourceSessionId: 'native-1',
            sourceKey: 'line:1'
        }])

        const resumed = engine.getOrCreateSession('runner-resume-tag', {
            path: '/tmp/project',
            host: 'local',
            flavor: 'claude',
            machineId: 'machine-1',
            startedBy: 'runner',
            startedFromRunner: true,
            lifecycleState: 'running',
            lifecycleStateSince: 2
        }, {
            requests: {
                req1: {
                    tool: 'bash',
                    arguments: { cmd: 'pwd' },
                    createdAt: 2
                }
            },
            completedRequests: {}
        }, namespace)

        store.messages.addMessage(resumed.id, { role: 'assistant', content: 'resumed-tail' })
        engine.handleSessionAlive({ sid: resumed.id, time: Date.now(), thinking: true })

        ;(engine as any).rpcGateway.spawnSession = async () => ({
            type: 'success',
            sessionId: resumed.id
        })

        const result = await engine.resumeSession(imported.id, namespace)

        expect(result).toEqual({
            type: 'success',
            sessionId: imported.id
        })

        const sessions = engine.getSessionsByNamespace(namespace)
        expect(sessions).toHaveLength(1)
        expect(engine.getSession(resumed.id)).toBeUndefined()

        const canonical = engine.getSession(imported.id)
        expect(canonical).toBeDefined()
        expect(canonical?.active).toBe(true)
        expect(canonical?.thinking).toBe(true)
        expect(canonical?.metadata).toEqual(expect.objectContaining({
            source: 'hybrid',
            nativeProvider: 'claude',
            nativeSessionId: 'native-1',
            startedBy: 'runner',
            startedFromRunner: true
        }))
        expect(canonical?.agentState?.requests).toEqual(expect.objectContaining({
            req1: expect.objectContaining({ tool: 'bash' })
        }))

        const messages = engine.getMessagesAfter(imported.id, { afterSeq: 0, limit: 10 })
        expect(messages.map((message) => message.content)).toEqual([
            { role: 'assistant', content: 'native-history' },
            { role: 'assistant', content: 'resumed-tail' }
        ])

        engine.stop()
        sseManager.stop()
    })

    it('marks imported session as hybrid when resume reuses the same session ID', async () => {
        const { engine, sseManager } = createEngine()
        const namespace = 'default'

        engine.getOrCreateMachine('machine-1', {
            host: 'local',
            platform: 'linux',
            happyCliVersion: '0.1.0'
        }, null, namespace)
        engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

        const imported = engine.upsertNativeSession({
            tag: 'native:codex:project:native-2',
            namespace,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                flavor: 'codex',
                machineId: 'machine-1',
                source: 'native',
                nativeProvider: 'codex',
                nativeSessionId: 'native-2',
                nativeProjectPath: '/tmp/project',
                nativeDiscoveredAt: 1,
                codexSessionId: 'native-2'
            },
            agentState: null
        })

        engine.handleSessionAlive({ sid: imported.id, time: Date.now(), thinking: false })
        ;(engine as any).rpcGateway.spawnSession = async () => ({
            type: 'success',
            sessionId: imported.id
        })
        ;(engine as any).waitForSessionActive = async () => true

        const result = await engine.resumeSession(imported.id, namespace)

        expect(result).toEqual({
            type: 'success',
            sessionId: imported.id
        })
        expect(engine.getSession(imported.id)?.metadata).toEqual(expect.objectContaining({
            source: 'hybrid',
            nativeProvider: 'codex',
            nativeSessionId: 'native-2'
        }))

        engine.stop()
        sseManager.stop()
    })

    it('preserves hybrid metadata and agent state when native sync re-upserts the canonical session', async () => {
        const { engine, sseManager } = createEngine()
        const namespace = 'default'

        engine.getOrCreateMachine('machine-1', {
            host: 'local',
            platform: 'linux',
            happyCliVersion: '0.1.0'
        }, null, namespace)
        engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

        const imported = engine.upsertNativeSession({
            tag: 'native:claude:project:native-3',
            namespace,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                flavor: 'claude',
                machineId: 'machine-1',
                source: 'native',
                nativeProvider: 'claude',
                nativeSessionId: 'native-3',
                nativeProjectPath: '/tmp/project',
                nativeDiscoveredAt: 1,
                claudeSessionId: 'native-3'
            },
            agentState: null
        })

        const resumed = engine.getOrCreateSession('runner-resume-tag-2', {
            path: '/tmp/project',
            host: 'local',
            flavor: 'claude',
            machineId: 'machine-1',
            startedBy: 'runner',
            startedFromRunner: true,
            lifecycleState: 'running',
            lifecycleStateSince: 2
        }, {
            requests: {
                req1: {
                    tool: 'bash',
                    arguments: { cmd: 'pwd' },
                    createdAt: 2
                }
            },
            completedRequests: {}
        }, namespace)

        engine.handleSessionAlive({ sid: resumed.id, time: Date.now(), thinking: true })
        ;(engine as any).rpcGateway.spawnSession = async () => ({
            type: 'success',
            sessionId: resumed.id
        })

        const result = await engine.resumeSession(imported.id, namespace)

        expect(result).toEqual({
            type: 'success',
            sessionId: imported.id
        })

        const beforeResync = engine.getSession(imported.id)
        expect(beforeResync?.metadata).toEqual(expect.objectContaining({
            source: 'hybrid',
            startedBy: 'runner',
            startedFromRunner: true
        }))
        expect(beforeResync?.agentState?.requests).toEqual(expect.objectContaining({
            req1: expect.objectContaining({ tool: 'bash' })
        }))

        engine.upsertNativeSession({
            tag: 'native:claude:project:native-3',
            namespace,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                flavor: 'claude',
                machineId: 'machine-1',
                source: 'native',
                nativeProvider: 'claude',
                nativeSessionId: 'native-3',
                nativeProjectPath: '/tmp/project',
                nativeDiscoveredAt: 1,
                claudeSessionId: 'native-3',
                name: 'updated native title'
            },
            agentState: null
        })

        const afterResync = engine.getSession(imported.id)
        expect(afterResync?.metadata).toEqual(expect.objectContaining({
            source: 'hybrid',
            startedBy: 'runner',
            startedFromRunner: true,
            name: 'updated native title',
            nativeProvider: 'claude',
            nativeSessionId: 'native-3'
        }))
        expect(afterResync?.agentState?.requests).toEqual(expect.objectContaining({
            req1: expect.objectContaining({ tool: 'bash' })
        }))

        engine.stop()
        sseManager.stop()
    })
})
