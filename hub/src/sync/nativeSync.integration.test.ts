import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import type { Server } from 'socket.io'
import type { RawEventEnvelope } from '@hapi/protocol'

import { createConfiguration, configuration } from '../configuration'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SSEManager } from '../sse/sseManager'
import { SyncEngine } from './syncEngine'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import { createCliRoutes } from '../web/routes/cli'
import { createAuthMiddleware } from '../web/middleware/auth'
import { createMessagesRoutes } from '../web/routes/messages'
import { createSessionsRoutes } from '../web/routes/sessions'

type NativeSyncState = {
    sessionId: string
    provider: 'claude' | 'codex'
    nativeSessionId: string
    machineId: string
    cursor: string | null
    filePath: string | null
    mtime: number | null
    lastSyncedAt: number | null
    syncStatus: 'healthy' | 'error'
    lastError: string | null
}

type NativeSessionSummary = {
    provider: 'claude' | 'codex'
    nativeSessionId: string
    projectPath: string
    displayPath: string
    flavor: 'claude' | 'codex'
    createdAt: number
    discoveredAt: number
    lastActivityAt: number
    title?: string
}

type NativeSyncProvider = {
    name: string
    discoverSessions: () => Promise<NativeSessionSummary[]>
    readMessages: (
        summary: NativeSessionSummary,
        state: NativeSyncState | null,
        context?: {
            sessionId: string
            ingestedAt: number
        }
    ) => Promise<{
        events: RawEventEnvelope[]
        cursor: string | null
        filePath?: string | null
        mtime?: number | null
    }>
}

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

    return { engine, sseManager }
}

function createApp(engine: SyncEngine, jwtSecret: Uint8Array) {
    const app = new Hono()
    app.route('/cli', createCliRoutes(() => engine))
    app.use('/api/*', createAuthMiddleware(jwtSecret))
    app.route('/api', createSessionsRoutes(() => engine))
    app.route('/api', createMessagesRoutes(() => engine))
    return app
}

function createWebToken(jwtSecret: Uint8Array): string {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
        uid: 1,
        ns: 'default',
        iat: now,
        exp: now + (15 * 60)
    })).toString('base64url')
    const signature = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')
    return `${header}.${payload}.${signature}`
}

async function readJsonLines(
    filePath: string,
    state: NativeSyncState | null,
    toEvent: (line: string, lineIndex: number) => RawEventEnvelope
) {
    const file = await Bun.file(filePath).text()
    const lines = file.split('\n').filter((line) => line.trim().length > 0)
    const startLine = state?.cursor ? Number.parseInt(state.cursor, 10) : 0
    const nextLines = lines.slice(Number.isFinite(startLine) ? startLine : 0)

    return {
        events: nextLines.map((line, offset) => toEvent(line, (Number.isFinite(startLine) ? startLine : 0) + offset)),
        cursor: String(lines.length),
        filePath,
        mtime: Date.now()
    }
}

function createNativeRawEvent(overrides: Partial<RawEventEnvelope> & Pick<RawEventEnvelope, 'id' | 'sessionId' | 'provider' | 'sourceSessionId' | 'sourceKey' | 'channel' | 'sourceOrder' | 'occurredAt' | 'ingestedAt' | 'rawType' | 'payload'>): RawEventEnvelope {
    const {
        id,
        sessionId,
        provider,
        sourceSessionId,
        sourceKey,
        channel,
        sourceOrder,
        occurredAt,
        ingestedAt,
        rawType,
        payload,
        ...rest
    } = overrides

    return {
        ...rest,
        id,
        sessionId,
        provider,
        source: 'native',
        sourceSessionId,
        sourceKey,
        observationKey: null,
        channel,
        sourceOrder,
        occurredAt,
        ingestedAt,
        rawType,
        payload,
        ingestSchemaVersion: 1
    }
}

describe('native sync integration', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'hapi-native-sync-int-'))
    const hubHome = join(tempRoot, 'hapi-home')
    const claudeHome = join(tempRoot, 'claude-home')
    const codexHome = join(tempRoot, 'codex-home')
    const jwtSecret = new TextEncoder().encode('native-sync-integration-secret')

    let NativeSyncService: any

    beforeAll(async () => {
        process.env.HAPI_HOME = hubHome
        process.env.CLI_API_TOKEN = 'test-cli-native-token'
        process.env.CLAUDE_CONFIG_DIR = claudeHome
        process.env.CODEX_HOME = codexHome
        await createConfiguration()

        const nativeSyncServiceModulePath = ['..', '..', '..', 'cli', 'src', 'nativeSync', 'NativeSyncService'].join('/')
        ;({ NativeSyncService } = await import(nativeSyncServiceModulePath))
    })

    afterAll(async () => {
        delete process.env.CLAUDE_CONFIG_DIR
        delete process.env.CODEX_HOME
        delete process.env.CLI_API_TOKEN
        delete process.env.HAPI_HOME
        if (existsSync(tempRoot)) {
            await rm(tempRoot, { recursive: true, force: true })
        }
    })

    it('imports native Claude and Codex sessions and exposes appended native messages through web APIs', async () => {
        const claudeProjectPath = '/workspace/native-claude-project'
        const claudeSessionId = 'claude-native-1'
        const claudeProjectDir = join(claudeHome, 'projects', 'workspace-native-claude-project')
        const claudeSessionFile = join(claudeProjectDir, `${claudeSessionId}.jsonl`)
        await mkdir(claudeProjectDir, { recursive: true })
        await writeFile(claudeSessionFile, [
            JSON.stringify({
                type: 'user',
                uuid: 'claude-user-1',
                sessionId: claudeSessionId,
                cwd: claudeProjectPath,
                timestamp: '2026-03-15T00:00:00.000Z',
                message: {
                    role: 'user',
                    content: 'hello from claude'
                }
            }),
            JSON.stringify({
                type: 'assistant',
                uuid: 'claude-assistant-1',
                sessionId: claudeSessionId,
                cwd: claudeProjectPath,
                timestamp: '2026-03-15T00:00:01.000Z',
                message: {
                    role: 'assistant',
                    content: 'claude reply'
                }
            })
        ].join('\n') + '\n')

        const codexSessionId = 'codex-native-1'
        const codexProjectPath = '/workspace/native-codex-project'
        const codexSessionDir = join(codexHome, 'sessions', '2026', '03', '15')
        const codexSessionFile = join(codexSessionDir, `codex-${codexSessionId}.jsonl`)
        await mkdir(codexSessionDir, { recursive: true })
        await writeFile(codexSessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: codexSessionId,
                    cwd: codexProjectPath,
                    timestamp: '2026-03-15T00:00:00.000Z'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'agent_message',
                    message: 'hello from codex',
                    timestamp: '2026-03-15T00:00:02.000Z'
                }
            })
        ].join('\n') + '\n')

        const { engine, sseManager } = createEngine()
        const app = createApp(engine, jwtSecret)
        const webToken = createWebToken(jwtSecret)
        const claudeSummary: NativeSessionSummary = {
            provider: 'claude',
            nativeSessionId: claudeSessionId,
            projectPath: claudeProjectPath,
            displayPath: claudeProjectPath,
            flavor: 'claude',
            createdAt: Date.parse('2026-03-15T00:00:00.000Z'),
            discoveredAt: Date.parse('2026-03-15T00:00:00.000Z'),
            lastActivityAt: Date.parse('2026-03-15T00:00:01.000Z'),
            title: 'hello from claude'
        }
        const codexSummary: NativeSessionSummary = {
            provider: 'codex',
            nativeSessionId: codexSessionId,
            projectPath: codexProjectPath,
            displayPath: codexProjectPath,
            flavor: 'codex',
            createdAt: Date.parse('2026-03-15T00:00:00.000Z'),
            discoveredAt: Date.parse('2026-03-15T00:00:00.000Z'),
            lastActivityAt: Date.parse('2026-03-15T00:00:02.000Z')
        }
        const claudeProvider: NativeSyncProvider = {
            name: 'claude',
            async discoverSessions() {
                return [claudeSummary]
            },
            async readMessages(summary, state, context) {
                expect(summary).toEqual(claudeSummary)
                const sessionId = context?.sessionId ?? claudeSummary.nativeSessionId
                const ingestedAt = context?.ingestedAt ?? Date.now()
                return await readJsonLines(claudeSessionFile, state, (line, lineIndex) => {
                    const event = JSON.parse(line) as Record<string, unknown>
                    return createNativeRawEvent({
                        id: `claude:${claudeSessionId}:${lineIndex}`,
                        sessionId,
                        provider: 'claude',
                        sourceSessionId: claudeSessionId,
                        sourceKey: `line:${lineIndex}`,
                        channel: `claude:file:${claudeSessionFile}`,
                        sourceOrder: lineIndex,
                        occurredAt: Date.parse(String(event.timestamp)),
                        ingestedAt,
                        rawType: String(event.type),
                        payload: event
                    })
                })
            }
        }
        const codexProvider: NativeSyncProvider = {
            name: 'codex',
            async discoverSessions() {
                return [codexSummary]
            },
            async readMessages(summary, state, context) {
                expect(summary).toEqual(codexSummary)
                const sessionId = context?.sessionId ?? codexSummary.nativeSessionId
                const ingestedAt = context?.ingestedAt ?? Date.now()
                return await readJsonLines(codexSessionFile, state, (line, lineIndex) => {
                    const parsed = JSON.parse(line) as { type: string; payload?: { timestamp?: string } }
                    return createNativeRawEvent({
                        id: `codex:${codexSessionId}:${lineIndex}`,
                        sessionId,
                        provider: 'codex',
                        sourceSessionId: codexSessionId,
                        sourceKey: `file:2026/03/15/codex-${codexSessionId}.jsonl:line:${lineIndex}`,
                        channel: `codex:file:2026/03/15/codex-${codexSessionId}.jsonl`,
                        sourceOrder: lineIndex,
                        occurredAt: Date.parse(String(parsed.payload?.timestamp ?? '2026-03-15T00:00:00.000Z')),
                        ingestedAt,
                        rawType: parsed.type,
                        payload: parsed.type === 'event_msg' ? (parsed.payload ?? parsed) : parsed
                    })
                })
            }
        }

        const nativeApi = {
            async upsertNativeSession(payload: Record<string, unknown>) {
                const response = await app.request('http://localhost/cli/native/sessions/upsert', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${configuration.cliApiToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                })
                if (!response.ok) {
                    throw new Error(`upsert failed: ${response.status} ${await response.text()}`)
                }
                const json = await response.json() as { session: { id: string } }
                return { id: json.session.id }
            },
            async getNativeSyncState(sessionId: string) {
                const response = await app.request(`http://localhost/cli/native/sessions/${encodeURIComponent(sessionId)}/sync-state`, {
                    headers: {
                        Authorization: `Bearer ${configuration.cliApiToken}`
                    }
                })
                if (!response.ok) {
                    throw new Error(`sync-state read failed: ${response.status} ${await response.text()}`)
                }
                const json = await response.json() as { state: unknown }
                return json.state
            },
            async importNativeRawEvents(sessionId: string, events: RawEventEnvelope[]) {
                const response = await app.request(`http://localhost/cli/native/sessions/${encodeURIComponent(sessionId)}/raw-events/import`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${configuration.cliApiToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ events })
                })
                if (!response.ok) {
                    throw new Error(`raw event import failed: ${response.status} ${await response.text()}`)
                }
                const json = await response.json() as { imported: number }
                return { imported: json.imported }
            },
            async updateNativeSyncState(state: Record<string, unknown>) {
                const sessionId = String(state.sessionId)
                const response = await app.request(`http://localhost/cli/native/sessions/${encodeURIComponent(sessionId)}/sync-state`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${configuration.cliApiToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(state)
                })
                if (!response.ok) {
                    throw new Error(`sync-state write failed: ${response.status} ${await response.text()}`)
                }
                const json = await response.json() as { state: unknown }
                return json.state
            }
        }

        let now = Date.parse('2026-03-15T00:00:05.000Z')
        const service = new NativeSyncService({
            api: nativeApi,
            providers: [claudeProvider, codexProvider],
            machineId: 'machine-1',
            host: 'local',
            pollIntervalMs: 60_000,
            now: () => now
        })

        try {
            await service.syncOnce()

            const sessionsResponse = await app.request('http://localhost/api/sessions', {
                headers: {
                    Authorization: `Bearer ${webToken}`
                }
            })
            expect(sessionsResponse.status).toBe(200)
            const sessionsJson = await sessionsResponse.json() as {
                sessions: Array<{
                    id: string
                    createdAt: number
                    updatedAt: number
                    metadata: {
                        source?: string
                        nativeProvider?: string
                        nativeSessionId?: string
                    } | null
                }>
            }

            expect(sessionsJson.sessions).toHaveLength(2)
            expect(sessionsJson.sessions).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    createdAt: Date.parse('2026-03-15T00:00:00.000Z'),
                    updatedAt: Date.parse('2026-03-15T00:00:01.000Z'),
                    metadata: expect.objectContaining({
                        source: 'native',
                        nativeProvider: 'claude',
                        nativeSessionId: claudeSessionId
                    })
                }),
                expect.objectContaining({
                    createdAt: Date.parse('2026-03-15T00:00:00.000Z'),
                    updatedAt: Date.parse('2026-03-15T00:00:02.000Z'),
                    metadata: expect.objectContaining({
                        source: 'native',
                        nativeProvider: 'codex',
                        nativeSessionId: codexSessionId
                    })
                })
            ]))

            const claudeSession = sessionsJson.sessions.find((session) => session.metadata?.nativeSessionId === claudeSessionId)
            expect(claudeSession).toBeDefined()

            await appendFile(claudeSessionFile, JSON.stringify({
                type: 'assistant',
                uuid: 'claude-assistant-2',
                sessionId: claudeSessionId,
                cwd: claudeProjectPath,
                timestamp: '2026-03-15T00:00:03.000Z',
                message: {
                    role: 'assistant',
                    content: 'claude tail reply'
                }
            }) + '\n')
            claudeSummary.lastActivityAt = Date.parse('2026-03-15T00:00:03.000Z')
            now = Date.parse('2026-03-15T00:00:10.000Z')

            await service.syncOnce()

            const messagesResponse = await app.request(`http://localhost/api/sessions/${encodeURIComponent(claudeSession!.id)}/messages?limit=20`, {
                headers: {
                    Authorization: `Bearer ${webToken}`
                }
            })
            expect(messagesResponse.status).toBe(200)
            const messagesJson = await messagesResponse.json() as {
                items: Array<{ kind: string; payload: Record<string, unknown> }>
                page: {
                    generation: number
                    latestStreamSeq: number
                }
            }

            expect(messagesJson.items).toHaveLength(3)
            expect(messagesJson.items.at(-1)).toEqual(expect.objectContaining({
                kind: 'agent-text',
                payload: expect.objectContaining({
                    text: 'claude tail reply'
                })
            }))
            expect(messagesJson.page).toEqual(expect.objectContaining({
                parserVersion: 1,
                latestStreamSeq: 3
            }))
        } finally {
            service.stop()
            engine.stop()
            sseManager.stop()
        }
    })

    it('uses provider lastActivityAt as updatedAt before any native messages are imported', async () => {
        const nativeSessionId = 'claude-native-empty'
        const projectPath = '/workspace/native-empty-project'
        const { engine, sseManager } = createEngine()

        const service = new NativeSyncService({
            api: {
                async upsertNativeSession(payload: Record<string, unknown>) {
                    const session = engine.upsertNativeSession({
                        tag: String(payload.tag),
                        namespace: 'default',
                        metadata: payload.metadata,
                        createdAt: Number(payload.createdAt),
                        lastActivityAt: Number(payload.lastActivityAt),
                        agentState: null
                    })
                    return { id: session.id }
                },
                async getNativeSyncState() {
                    return null
                },
                async importNativeRawEvents() {
                    return { imported: 0 }
                },
                async updateNativeSyncState() {
                    return null
                }
            },
            providers: [{
                name: 'claude',
                async discoverSessions() {
                    return [{
                        provider: 'claude',
                        nativeSessionId,
                        projectPath,
                        displayPath: projectPath,
                        flavor: 'claude',
                        createdAt: 100,
                        discoveredAt: 100,
                        lastActivityAt: 250,
                        title: 'empty'
                    }]
                },
                async readMessages() {
                    return {
                        events: [],
                        cursor: null,
                        filePath: null,
                        mtime: null
                    }
                }
            }],
            machineId: 'machine-1',
            host: 'local',
            pollIntervalMs: 60_000,
            now: () => 500
        })

        try {
            await service.syncOnce()

            const session = engine.getSessionsByNamespace('default').find((item) => item.metadata?.nativeSessionId === nativeSessionId)
            expect(session).toEqual(expect.objectContaining({
                createdAt: 100,
                updatedAt: 250
            }))
        } finally {
            service.stop()
            engine.stop()
            sseManager.stop()
        }
    })
})
