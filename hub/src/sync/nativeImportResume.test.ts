import { describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'
import type { CanonicalRootBlock, RawEventEnvelope } from '@hapi/protocol'

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

function createClaudeAssistantEvent(params: {
    id: string
    sessionId: string
    source: 'native' | 'runtime'
    sourceSessionId: string
    sourceKey: string
    sourceOrder: number
    occurredAt: number
    text: string
}): RawEventEnvelope {
    return {
        id: params.id,
        sessionId: params.sessionId,
        provider: 'claude',
        source: params.source,
        sourceSessionId: params.sourceSessionId,
        sourceKey: params.sourceKey,
        observationKey: null,
        channel: params.source === 'native' ? 'claude:file:/tmp/session.jsonl' : 'claude:runtime:messages',
        sourceOrder: params.sourceOrder,
        occurredAt: params.occurredAt,
        ingestedAt: params.occurredAt + 1,
        rawType: 'assistant',
        payload: {
            type: 'assistant',
            sessionId: params.sourceSessionId,
            timestamp: new Date(params.occurredAt).toISOString(),
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: params.text }]
            }
        },
        ingestSchemaVersion: 1
    }
}

function readCanonicalTexts(roots: CanonicalRootBlock[]): string[] {
    return roots
        .filter((root) => root.kind === 'agent-text' || root.kind === 'user-text')
        .map((root) => (typeof root.payload.text === 'string' ? root.payload.text : ''))
}

describe('native import resume takeover', () => {
    it('keeps native raw imports canonical-safe after a session becomes hybrid', async () => {
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
            createdAt: 1,
            lastActivityAt: 1,
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
        await engine.ingestRawEvents(imported.id, [
            createClaudeAssistantEvent({
                id: 'native-active-1',
                sessionId: imported.id,
                source: 'native',
                sourceSessionId: 'native-active',
                sourceKey: 'line:1',
                sourceOrder: 1,
                occurredAt: 1_000,
                text: 'native-tail'
            })
        ])

        expect(engine.getSession(imported.id)?.metadata).toEqual(expect.objectContaining({
            source: 'hybrid'
        }))
        expect(readCanonicalTexts(engine.getCanonicalMessagesPage(imported.id, {
            generation: null,
            beforeTimelineSeq: null,
            limit: 10
        }).items)).toEqual(['native-tail'])

        engine.stop()
        sseManager.stop()
    })

    it('merges resumed HAPI session raw events back into the imported canonical thread and marks it hybrid', async () => {
        const { engine, sseManager } = createEngine()
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
            createdAt: 1,
            lastActivityAt: 1,
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

        await engine.ingestRawEvents(imported.id, [
            createClaudeAssistantEvent({
                id: 'native-history-1',
                sessionId: imported.id,
                source: 'native',
                sourceSessionId: 'native-1',
                sourceKey: 'line:1',
                sourceOrder: 1,
                occurredAt: 1_000,
                text: 'native-history'
            })
        ])

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

        await engine.ingestRawEvents(resumed.id, [
            createClaudeAssistantEvent({
                id: 'runtime-tail-1',
                sessionId: resumed.id,
                source: 'runtime',
                sourceSessionId: 'native-1',
                sourceKey: 'runtime:1',
                sourceOrder: 1,
                occurredAt: 2_000,
                text: 'resumed-tail'
            })
        ])
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

        const canonicalTexts = readCanonicalTexts(engine.getCanonicalMessagesPage(imported.id, {
            generation: null,
            beforeTimelineSeq: null,
            limit: 10
        }).items)
        expect(canonicalTexts).toEqual(['native-history', 'resumed-tail'])
        expect(canonical?.updatedAt).toBeGreaterThanOrEqual(2_000)

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
            createdAt: 1,
            lastActivityAt: 1,
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
            createdAt: 1,
            lastActivityAt: 1,
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

        await engine.ingestRawEvents(resumed.id, [
            createClaudeAssistantEvent({
                id: 'hybrid-tail-1',
                sessionId: resumed.id,
                source: 'runtime',
                sourceSessionId: 'native-3',
                sourceKey: 'runtime:1',
                sourceOrder: 1,
                occurredAt: 2_000,
                text: 'hybrid-tail'
            })
        ])
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
        const beforeUpdatedAt = beforeResync?.updatedAt

        engine.upsertNativeSession({
            tag: 'native:claude:project:native-3',
            namespace,
            createdAt: 1,
            lastActivityAt: 999,
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
        expect(afterResync?.updatedAt).toBe(beforeUpdatedAt)

        engine.stop()
        sseManager.stop()
    })
})
