import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Server } from 'socket.io'
import type { RawEventEnvelope } from '@hapi/protocol'

import { Store } from '../../store'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { SSEManager } from '../../sse/sseManager'
import { SyncEngine } from '../../sync/syncEngine'
import { VisibilityTracker } from '../../visibility/visibilityTracker'
import { configuration, createConfiguration } from '../../configuration'
import { createCliRoutes } from './cli'

const tempConfigDir = mkdtempSync(join(tmpdir(), 'hapi-cli-routes-'))

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

    return { engine, sseManager }
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

function createClaudeRawEvent(sessionId: string, overrides: Partial<RawEventEnvelope> = {}): RawEventEnvelope {
    return {
        id: 'raw-runtime-user',
        sessionId,
        provider: 'claude',
        source: 'runtime',
        sourceSessionId: sessionId,
        sourceKey: 'runtime:user:1',
        observationKey: null,
        channel: 'claude:runtime:messages',
        sourceOrder: 1,
        occurredAt: 200,
        ingestedAt: 201,
        rawType: 'user',
        payload: {
            type: 'user',
            sessionId,
            cwd: '/tmp/cli-backfill',
            timestamp: '2026-03-17T00:00:00.200Z',
            message: {
                content: 'hello from web backfill'
            },
            localId: 'local-web-1',
            meta: {
                sentFrom: 'webapp'
            }
        },
        ingestSchemaVersion: 1,
        ...overrides
    }
}

describe('CLI routes messages backfill', () => {
    beforeAll(async () => {
        process.env.HAPI_HOME = tempConfigDir
        process.env.CLI_API_TOKEN = 'test-cli-routes-token'
        await createConfiguration()
    })

    afterAll(() => {
        rmSync(tempConfigDir, { recursive: true, force: true })
    })

    it('backfills user-visible outbound messages from runtime raw events using ingest_seq cursor', async () => {
        const { engine, sseManager } = createTestEngine()
        const app = createCliRoutes(() => engine)
        const session = engine.getOrCreateSession('tag:cli-backfill', {
            path: '/tmp/cli-backfill',
            host: 'local',
            source: 'hapi',
            flavor: 'claude'
        }, null, 'default')

        await engine.ingestRawEvents(session.id, [
            createClaudeRawEvent(session.id, {
                id: 'raw-runtime-assistant',
                sourceKey: 'runtime:assistant:1',
                rawType: 'assistant',
                occurredAt: 100,
                ingestedAt: 101,
                payload: {
                    type: 'assistant',
                    sessionId: session.id,
                    cwd: '/tmp/cli-backfill',
                    timestamp: '2026-03-17T00:00:00.100Z',
                    message: {
                        content: 'assistant-only'
                    }
                }
            }),
            createClaudeRawEvent(session.id)
        ])

        const response = await app.request(`http://localhost/sessions/${encodeURIComponent(session.id)}/messages?afterSeq=1&limit=20`, {
            method: 'GET',
            headers: authHeaders(configuration.cliApiToken)
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            messages: [{
                id: 'raw-runtime-user',
                seq: 2,
                createdAt: 200,
                localId: 'local-web-1',
                content: {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: 'hello from web backfill'
                    },
                    meta: {
                        sentFrom: 'webapp'
                    }
                }
            }]
        })

        engine.stop()
        sseManager.stop()
    })

    it('backfills user-visible outbound messages written through sendMessage canonical ingest', async () => {
        const { engine, sseManager } = createTestEngine()
        const app = createCliRoutes(() => engine)
        const session = engine.getOrCreateSession('tag:cli-backfill-send-message', {
            path: '/tmp/cli-backfill-send-message',
            host: 'local',
            source: 'hapi',
            flavor: 'codex',
            codexSessionId: 'codex-thread-send-message'
        }, null, 'default')

        await engine.sendMessage(session.id, {
            text: 'hello from sendMessage canonical path',
            localId: 'local-send-message-1',
            sentFrom: 'webapp'
        })

        const response = await app.request(`http://localhost/sessions/${encodeURIComponent(session.id)}/messages?afterSeq=0&limit=20`, {
            method: 'GET',
            headers: authHeaders(configuration.cliApiToken)
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            messages: [expect.objectContaining({
                localId: 'local-send-message-1',
                content: {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: 'hello from sendMessage canonical path'
                    },
                    meta: {
                        sentFrom: 'webapp'
                    }
                }
            })]
        })

        engine.stop()
        sseManager.stop()
    })
})
