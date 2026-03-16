import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Server } from 'socket.io'

import { Store } from '../../store'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { SyncEngine } from '../../sync/syncEngine'
import { VisibilityTracker } from '../../visibility/visibilityTracker'
import { SSEManager } from '../../sse/sseManager'
import { configuration, createConfiguration } from '../../configuration'
import { createCliRoutes } from './cli'

const tempConfigDir = mkdtempSync(join(tmpdir(), 'hapi-cli-native-routes-'))

function createTestEngine() {
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

function authHeaders(token?: string): Record<string, string> {
    if (!token) {
        return {
            'Content-Type': 'application/json'
        }
    }

    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
    }
}

describe('CLI native routes', () => {
    beforeAll(async () => {
        process.env.HAPI_HOME = tempConfigDir
        process.env.CLI_API_TOKEN = 'test-cli-native-token'
        await createConfiguration()
    })

    afterAll(() => {
        rmSync(tempConfigDir, { recursive: true, force: true })
    })

    it('requires CLI auth for native ingest routes', async () => {
        const { engine, sseManager } = createTestEngine()
        const app = createCliRoutes(() => engine)

        const response = await app.request('http://localhost/native/sessions/upsert', {
            method: 'POST',
            headers: authHeaders(undefined),
            body: JSON.stringify({
                tag: 'native:claude:project:native-1',
                createdAt: 1,
                lastActivityAt: 1,
                metadata: {
                    path: '/tmp/project',
                    host: 'local'
                }
            })
        })

        expect(response.status).toBe(401)

        engine.stop()
        sseManager.stop()
    })

    it('upserts native sessions idempotently by stable tag', async () => {
        const { engine, sseManager } = createTestEngine()
        const app = createCliRoutes(() => engine)
        const body = {
            tag: 'native:claude:project:native-1',
            createdAt: 10,
            lastActivityAt: 20,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                flavor: 'claude',
                source: 'native',
                nativeProvider: 'claude',
                nativeSessionId: 'native-1',
                nativeProjectPath: '/tmp/project',
                nativeDiscoveredAt: 1
            },
            agentState: null
        }

        const firstResponse = await app.request('http://localhost/native/sessions/upsert', {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify(body)
        })
        const secondResponse = await app.request('http://localhost/native/sessions/upsert', {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify(body)
        })

        expect(firstResponse.status).toBe(200)
        expect(secondResponse.status).toBe(200)

        const firstJson = await firstResponse.json() as { session: { id: string } }
        const secondJson = await secondResponse.json() as { session: { id: string } }
        expect(firstJson.session.id).toBe(secondJson.session.id)

        engine.stop()
        sseManager.stop()
    })

    it('returns an existing session when existingSessionId is provided', async () => {
        const { engine, sseManager } = createTestEngine()
        const app = createCliRoutes(() => engine)
        const existing = engine.getOrCreateSession('existing-tag', {
            path: '/tmp/project',
            host: 'local',
            flavor: 'claude'
        }, null, 'default')

        const response = await app.request('http://localhost/sessions', {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify({
                tag: 'ignored-tag',
                existingSessionId: existing.id,
                metadata: {
                    path: '/tmp/other-project',
                    host: 'local'
                },
                agentState: null
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            session: expect.objectContaining({
                id: existing.id
            })
        })

        engine.stop()
        sseManager.stop()
    })

    it('imports native messages idempotently', async () => {
        const { engine, sseManager } = createTestEngine()
        const app = createCliRoutes(() => engine)

        const sessionResponse = await app.request('http://localhost/native/sessions/upsert', {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify({
                tag: 'native:codex:project:native-2',
                createdAt: 10,
                lastActivityAt: 10,
                metadata: {
                    path: '/tmp/project',
                    host: 'local',
                    flavor: 'codex',
                    source: 'native',
                    nativeProvider: 'codex',
                    nativeSessionId: 'native-2',
                    nativeProjectPath: '/tmp/project',
                    nativeDiscoveredAt: 2
                },
                agentState: null
            })
        })
        const sessionJson = await sessionResponse.json() as { session: { id: string } }

        const payload = {
            messages: [
                {
                    content: { role: 'assistant', content: 'hello' },
                    createdAt: 10,
                    sourceProvider: 'codex',
                    sourceSessionId: 'native-2',
                    sourceKey: 'line:1'
                }
            ]
        }

        const firstImport = await app.request(`http://localhost/native/sessions/${sessionJson.session.id}/messages/import`, {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify(payload)
        })
        const secondImport = await app.request(`http://localhost/native/sessions/${sessionJson.session.id}/messages/import`, {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify(payload)
        })

        expect(firstImport.status).toBe(200)
        expect(secondImport.status).toBe(200)
        expect(await firstImport.json()).toEqual(expect.objectContaining({ imported: 1 }))
        expect(await secondImport.json()).toEqual(expect.objectContaining({ imported: 0 }))
        expect(engine.getMessagesAfter(sessionJson.session.id, { afterSeq: 0, limit: 10 })).toHaveLength(1)

        engine.stop()
        sseManager.stop()
    })

    it('validates native sync-state provider and session identity', async () => {
        const { engine, sseManager } = createTestEngine()
        const app = createCliRoutes(() => engine)

        const sessionResponse = await app.request('http://localhost/native/sessions/upsert', {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify({
                tag: 'native:claude:project:native-3',
                createdAt: 10,
                lastActivityAt: 10,
                metadata: {
                    path: '/tmp/project',
                    host: 'local',
                    flavor: 'claude',
                    source: 'native',
                    nativeProvider: 'claude',
                    nativeSessionId: 'native-3',
                    nativeProjectPath: '/tmp/project',
                    nativeDiscoveredAt: 3
                },
                agentState: null
            })
        })
        const sessionJson = await sessionResponse.json() as { session: { id: string } }

        const mismatchResponse = await app.request(`http://localhost/native/sessions/${sessionJson.session.id}/sync-state`, {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify({
                provider: 'codex',
                nativeSessionId: 'native-3',
                machineId: 'machine-1',
                cursor: '10',
                filePath: '/tmp/session.jsonl',
                mtime: 11,
                lastSyncedAt: 12,
                syncStatus: 'healthy',
                lastError: null
            })
        })

        expect(mismatchResponse.status).toBe(409)

        const okResponse = await app.request(`http://localhost/native/sessions/${sessionJson.session.id}/sync-state`, {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify({
                provider: 'claude',
                nativeSessionId: 'native-3',
                machineId: 'machine-1',
                cursor: '10',
                filePath: '/tmp/session.jsonl',
                mtime: 11,
                lastSyncedAt: 12,
                syncStatus: 'healthy',
                lastError: null
            })
        })

        expect(okResponse.status).toBe(200)

        const stateResponse = await app.request(`http://localhost/native/sessions/${sessionJson.session.id}/sync-state`, {
            method: 'GET',
            headers: authHeaders(configuration.cliApiToken)
        })
        expect(stateResponse.status).toBe(200)
        expect(await stateResponse.json()).toEqual({
            state: {
                sessionId: sessionJson.session.id,
                provider: 'claude',
                nativeSessionId: 'native-3',
                machineId: 'machine-1',
                cursor: '10',
                filePath: '/tmp/session.jsonl',
                mtime: 11,
                lastSyncedAt: 12,
                syncStatus: 'healthy',
                lastError: null
            }
        })

        engine.stop()
        sseManager.stop()
    })

    it('validates native session upsert timestamps', async () => {
        const { engine, sseManager } = createTestEngine()
        const app = createCliRoutes(() => engine)
        const baseBody = {
            tag: 'native:claude:project:native-invalid',
            metadata: {
                path: '/tmp/project',
                host: 'local',
                flavor: 'claude',
                source: 'native',
                nativeProvider: 'claude',
                nativeSessionId: 'native-invalid',
                nativeProjectPath: '/tmp/project',
                nativeDiscoveredAt: 1
            },
            agentState: null
        }

        const invalidBodies = [
            { ...baseBody, lastActivityAt: 1 },
            { ...baseBody, createdAt: 1 },
            { ...baseBody, createdAt: Number.NaN, lastActivityAt: 1 },
            { ...baseBody, createdAt: Number.POSITIVE_INFINITY, lastActivityAt: 1 },
            { ...baseBody, createdAt: 0, lastActivityAt: 1 },
            { ...baseBody, createdAt: 2, lastActivityAt: 1 }
        ]

        for (const body of invalidBodies) {
            const response = await app.request('http://localhost/native/sessions/upsert', {
                method: 'POST',
                headers: authHeaders(configuration.cliApiToken),
                body: JSON.stringify(body)
            })
            expect(response.status).toBe(400)
        }

        const okResponse = await app.request('http://localhost/native/sessions/upsert', {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify({
                ...baseBody,
                createdAt: 1,
                lastActivityAt: 2
            })
        })

        expect(okResponse.status).toBe(200)

        engine.stop()
        sseManager.stop()
    })

    it('does not let sync-state bookkeeping rewrite session recency', async () => {
        const { engine, sseManager } = createTestEngine()
        const app = createCliRoutes(() => engine)

        const sessionResponse = await app.request('http://localhost/native/sessions/upsert', {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify({
                tag: 'native:claude:project:native-4',
                createdAt: 10,
                lastActivityAt: 20,
                metadata: {
                    path: '/tmp/project',
                    host: 'local',
                    flavor: 'claude',
                    source: 'native',
                    nativeProvider: 'claude',
                    nativeSessionId: 'native-4',
                    nativeProjectPath: '/tmp/project',
                    nativeDiscoveredAt: 10,
                    claudeSessionId: 'native-4'
                },
                agentState: null
            })
        })
        const sessionJson = await sessionResponse.json() as { session: { id: string } }
        const before = engine.getSession(sessionJson.session.id)
        expect(before).toEqual(expect.objectContaining({
            createdAt: 10,
            updatedAt: 20
        }))

        const response = await app.request(`http://localhost/native/sessions/${sessionJson.session.id}/sync-state`, {
            method: 'POST',
            headers: authHeaders(configuration.cliApiToken),
            body: JSON.stringify({
                provider: 'claude',
                nativeSessionId: 'native-4',
                machineId: 'machine-1',
                cursor: '10',
                filePath: '/tmp/session.jsonl',
                mtime: 11,
                lastSyncedAt: 999,
                syncStatus: 'healthy',
                lastError: null
            })
        })

        expect(response.status).toBe(200)
        expect(engine.getSession(sessionJson.session.id)).toEqual(expect.objectContaining({
            createdAt: 10,
            updatedAt: 20
        }))

        engine.stop()
        sseManager.stop()
    })
})
