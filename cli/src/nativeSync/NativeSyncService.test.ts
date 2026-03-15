import { describe, expect, it, vi } from 'vitest'

import { NativeSyncService } from './NativeSyncService'
import type { NativeSyncState, NativeMessage, NativeSessionSummary } from './types'
import { buildStableNativeTag, type NativeSyncProvider } from './providers/provider'

function createSummary(overrides: Partial<NativeSessionSummary> = {}): NativeSessionSummary {
    return {
        provider: 'claude',
        nativeSessionId: 'native-1',
        projectPath: '/tmp/project',
        displayPath: '/tmp/project',
        flavor: 'claude',
        discoveredAt: 100,
        lastActivityAt: 200,
        title: 'Native session',
        ...overrides
    }
}

function createMessage(sourceKey: string, createdAt: number, content: unknown): NativeMessage {
    return {
        sourceKey,
        createdAt,
        content
    }
}

function createState(overrides: Partial<NativeSyncState> = {}): NativeSyncState {
    return {
        sessionId: 'hapi-session-1',
        provider: 'claude',
        nativeSessionId: 'native-1',
        machineId: 'machine-1',
        cursor: 'cursor-1',
        filePath: '/tmp/project/.native/session.jsonl',
        mtime: 123,
        lastSyncedAt: 456,
        syncStatus: 'healthy',
        lastError: null,
        ...overrides
    }
}

function createProvider(options: {
    summaries?: NativeSessionSummary[]
    readResult?: { messages: NativeMessage[]; cursor: string | null; filePath?: string | null; mtime?: number | null }
    readImplementation?: NativeSyncProvider['readMessages']
} = {}): NativeSyncProvider & {
    discoverSessions: ReturnType<typeof vi.fn>
    readMessages: ReturnType<typeof vi.fn>
} {
    return {
        name: options.summaries?.[0]?.provider ?? 'claude',
        discoverSessions: vi.fn().mockResolvedValue(options.summaries ?? []),
        readMessages: vi.fn(options.readImplementation ?? (async () => ({
            messages: options.readResult?.messages ?? [],
            cursor: options.readResult?.cursor ?? null,
            filePath: options.readResult?.filePath ?? null,
            mtime: options.readResult?.mtime ?? null
        })))
    }
}

function createApi(options: {
    sessionId?: string
    initialState?: NativeSyncState | null
    nextState?: NativeSyncState | null
} = {}) {
    return {
        upsertNativeSession: vi.fn().mockResolvedValue({ id: options.sessionId ?? 'hapi-session-1' }),
        getNativeSyncState: vi.fn()
            .mockResolvedValueOnce(options.initialState ?? null)
            .mockResolvedValue(options.nextState ?? options.initialState ?? null),
        importNativeMessages: vi.fn().mockResolvedValue({ imported: 0 }),
        updateNativeSyncState: vi.fn().mockResolvedValue(undefined)
    }
}

describe('buildStableNativeTag', () => {
    it('normalizes project paths before hashing', () => {
        const first = buildStableNativeTag(createSummary({ projectPath: '/tmp/project/' }))
        const second = buildStableNativeTag(createSummary({ projectPath: '/tmp/project' }))

        expect(first).toBe(second)
        expect(first).toMatch(/^native:claude:[a-f0-9]+:native-1$/)
    })
})

describe('NativeSyncService', () => {
    it('polls recently active native sessions more aggressively', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

        const summary = createSummary({ lastActivityAt: Date.now() })
        const provider = createProvider({ summaries: [summary] })
        const api = createApi()
        const service = new NativeSyncService({
            api,
            providers: [provider],
            machineId: 'machine-1',
            host: 'local',
            now: () => Date.now(),
            pollIntervalMs: 60_000
        })

        service.start()

        await vi.advanceTimersByTimeAsync(0)
        expect(provider.discoverSessions).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(10_000)
        expect(provider.discoverSessions).toHaveBeenCalledTimes(2)

        service.stop()
        vi.useRealTimers()
    })

    it('polls inactive native sessions less frequently', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

        const summary = createSummary({ lastActivityAt: Date.now() - (2 * 60 * 60_000) })
        const provider = createProvider({ summaries: [summary] })
        const api = createApi()
        const service = new NativeSyncService({
            api,
            providers: [provider],
            machineId: 'machine-1',
            host: 'local',
            now: () => Date.now(),
            pollIntervalMs: 30_000
        })

        service.start()

        await vi.advanceTimersByTimeAsync(0)
        expect(provider.discoverSessions).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(30_000)
        expect(provider.discoverSessions).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(90_000)
        expect(provider.discoverSessions).toHaveBeenCalledTimes(2)

        service.stop()
        vi.useRealTimers()
    })

    it('maps a new native session to one canonical HAPI session', async () => {
        const summary = createSummary()
        const messages = [
            createMessage('line:1', 101, { role: 'user', content: 'hi' }),
            createMessage('line:2', 102, { role: 'assistant', content: 'hello' })
        ]
        const provider = createProvider({
            summaries: [summary],
            readResult: {
                messages,
                cursor: 'line:2',
                filePath: '/tmp/project/.native/session.jsonl',
                mtime: 999
            }
        })
        const api = createApi()
        const service = new NativeSyncService({
            api,
            providers: [provider],
            machineId: 'machine-1',
            host: 'local',
            now: () => 5000,
            pollIntervalMs: 60_000
        })

        await service.syncOnce()

        expect(api.upsertNativeSession).toHaveBeenCalledWith(expect.objectContaining({
            tag: buildStableNativeTag(summary),
            metadata: expect.objectContaining({
                path: '/tmp/project',
                host: 'local',
                machineId: 'machine-1',
                source: 'native',
                nativeProvider: 'claude',
                nativeSessionId: 'native-1',
                claudeSessionId: 'native-1'
            })
        }))
        expect(api.getNativeSyncState).toHaveBeenCalledWith('hapi-session-1')
        expect(provider.readMessages).toHaveBeenCalledWith(summary, null)
        expect(api.importNativeMessages).toHaveBeenCalledWith('hapi-session-1', [
            expect.objectContaining({
                sourceKey: 'line:1',
                createdAt: 101
            }),
            expect.objectContaining({
                sourceKey: 'line:2',
                createdAt: 102
            })
        ])
        expect(api.updateNativeSyncState).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'hapi-session-1',
            provider: 'claude',
            nativeSessionId: 'native-1',
            machineId: 'machine-1',
            cursor: 'line:2',
            filePath: '/tmp/project/.native/session.jsonl',
            mtime: 999,
            lastSyncedAt: 5000,
            syncStatus: 'healthy',
            lastError: null
        }))
    })

    it('reuses the same stable tag and persisted sync state on repeated scans', async () => {
        const summary = createSummary()
        const initialState = createState({ cursor: 'line:2' })
        const provider = createProvider({
            summaries: [summary],
            readResult: {
                messages: [createMessage('line:3', 103, { role: 'assistant', content: 'new' })],
                cursor: 'line:3',
                filePath: '/tmp/project/.native/session.jsonl',
                mtime: 1000
            }
        })
        const api = createApi({
            initialState: null,
            nextState: initialState
        })
        const service = new NativeSyncService({
            api,
            providers: [provider],
            machineId: 'machine-1',
            host: 'local',
            now: () => 6000,
            pollIntervalMs: 60_000
        })

        await service.syncOnce()
        await service.syncOnce()

        expect(api.upsertNativeSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
            tag: buildStableNativeTag(summary)
        }))
        expect(api.upsertNativeSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
            tag: buildStableNativeTag(summary)
        }))
        expect(provider.readMessages).toHaveBeenNthCalledWith(2, summary, initialState)
    })

    it('imports only unseen native messages from the persisted cursor', async () => {
        const summary = createSummary()
        const existingState = createState({ cursor: 'line:2' })
        const provider = createProvider({
            summaries: [summary],
            readResult: {
                messages: [createMessage('line:3', 103, { role: 'assistant', content: 'tail' })],
                cursor: 'line:3'
            }
        })
        const api = createApi({
            initialState: existingState
        })
        const service = new NativeSyncService({
            api,
            providers: [provider],
            machineId: 'machine-1',
            host: 'local',
            now: () => 7000,
            pollIntervalMs: 60_000
        })

        await service.syncOnce()

        expect(provider.readMessages).toHaveBeenCalledWith(summary, existingState)
        expect(api.importNativeMessages).toHaveBeenCalledWith('hapi-session-1', [
            expect.objectContaining({ sourceKey: 'line:3' })
        ])
    })

    it('splits oversized native history imports into smaller chunks', async () => {
        const summary = createSummary()
        const largeText = 'x'.repeat(180_000)
        const provider = createProvider({
            summaries: [summary],
            readResult: {
                messages: [
                    createMessage('line:1', 101, { role: 'assistant', content: largeText }),
                    createMessage('line:2', 102, { role: 'assistant', content: largeText })
                ],
                cursor: 'line:2'
            }
        })
        const api = createApi()
        const service = new NativeSyncService({
            api,
            providers: [provider],
            machineId: 'machine-1',
            host: 'local',
            now: () => 7100,
            pollIntervalMs: 60_000
        })

        await service.syncOnce()

        expect(api.importNativeMessages).toHaveBeenCalledTimes(2)
        expect(api.importNativeMessages).toHaveBeenNthCalledWith(1, 'hapi-session-1', [
            expect.objectContaining({ sourceKey: 'line:1' })
        ])
        expect(api.importNativeMessages).toHaveBeenNthCalledWith(2, 'hapi-session-1', [
            expect.objectContaining({ sourceKey: 'line:2' })
        ])
    })

    it('resumes from persisted cursor after service restart', async () => {
        const summary = createSummary()
        const persistedState = createState({ cursor: 'line:5' })
        const provider = createProvider({
            summaries: [summary],
            readResult: {
                messages: [],
                cursor: 'line:5'
            }
        })
        const api = createApi({
            initialState: persistedState
        })

        const service = new NativeSyncService({
            api,
            providers: [provider],
            machineId: 'machine-1',
            host: 'local',
            now: () => 8000,
            pollIntervalMs: 60_000
        })

        await service.syncOnce()

        expect(provider.readMessages).toHaveBeenCalledWith(summary, persistedState)
        expect(api.updateNativeSyncState).toHaveBeenCalledWith(expect.objectContaining({
            cursor: 'line:5',
            lastSyncedAt: 8000
        }))
    })

    it('marks sync errors without crashing the scan loop', async () => {
        const failingSummary = createSummary({
            nativeSessionId: 'native-err'
        })
        const healthySummary = createSummary({
            nativeSessionId: 'native-ok'
        })
        const existingState = createState({
            nativeSessionId: 'native-err',
            cursor: 'line:9',
            filePath: '/tmp/project/.native/error.jsonl',
            mtime: 222
        })
        const provider = createProvider({
            summaries: [failingSummary, healthySummary],
            readImplementation: vi.fn(async (summary) => {
                if (summary.nativeSessionId === 'native-err') {
                    throw new Error('scan failed')
                }

                return {
                    messages: [createMessage('line:10', 110, { role: 'assistant', content: 'ok' })],
                    cursor: 'line:10',
                    filePath: '/tmp/project/.native/ok.jsonl',
                    mtime: 333
                }
            })
        })
        const api = {
            upsertNativeSession: vi.fn()
                .mockResolvedValueOnce({ id: 'hapi-session-err' })
                .mockResolvedValueOnce({ id: 'hapi-session-ok' }),
            getNativeSyncState: vi.fn()
                .mockResolvedValueOnce(existingState)
                .mockResolvedValueOnce(null),
            importNativeMessages: vi.fn().mockResolvedValue({ imported: 1 }),
            updateNativeSyncState: vi.fn().mockResolvedValue(undefined)
        }
        const service = new NativeSyncService({
            api,
            providers: [provider],
            machineId: 'machine-1',
            host: 'local',
            now: () => 9000,
            pollIntervalMs: 60_000
        })

        await expect(service.syncOnce()).resolves.toBeUndefined()

        expect(api.updateNativeSyncState).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'hapi-session-err',
            cursor: 'line:9',
            filePath: '/tmp/project/.native/error.jsonl',
            mtime: 222,
            lastSyncedAt: 9000,
            syncStatus: 'error',
            lastError: 'scan failed'
        }))
        expect(api.importNativeMessages).toHaveBeenCalledWith('hapi-session-ok', [
            expect.objectContaining({ sourceKey: 'line:10' })
        ])
    })
})
