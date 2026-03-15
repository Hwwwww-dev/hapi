import type { NativeSyncProvider } from './providers/provider'
import { buildStableNativeTag } from './providers/provider'
import type { NativeMessageImport, NativeSyncState, NativeSessionSummary } from './types'

export type NativeSyncApi = {
    upsertNativeSession(payload: {
        tag: string
        metadata: Record<string, unknown>
        agentState?: unknown | null
    }): Promise<{ id: string }>
    getNativeSyncState(sessionId: string): Promise<NativeSyncState | null>
    importNativeMessages(sessionId: string, messages: NativeMessageImport[]): Promise<{ imported: number }>
    updateNativeSyncState(state: NativeSyncState): Promise<unknown>
}

export class NativeSyncService {
    private static readonly MAX_IMPORT_BATCH_BYTES = 256 * 1024
    private static readonly ACTIVE_ACTIVITY_WINDOW_MS = 5 * 60_000
    private static readonly WARM_ACTIVITY_WINDOW_MS = 30 * 60_000
    private static readonly ACTIVE_POLL_INTERVAL_MS = 5_000
    private static readonly IDLE_POLL_INTERVAL_MS = 120_000

    private readonly api: NativeSyncApi
    private readonly providers: NativeSyncProvider[]
    private readonly machineId: string
    private readonly host: string
    private readonly pollIntervalMs: number
    private readonly now: () => number
    private timer: NodeJS.Timeout | null = null
    private syncInFlight: Promise<void> | null = null
    private running = false
    private nextPollDelayMs: number
    private readonly lastSessionSyncAt: Map<string, number> = new Map()

    constructor(options: {
        api: NativeSyncApi
        providers: NativeSyncProvider[]
        machineId: string
        host: string
        pollIntervalMs?: number
        now?: () => number
    }) {
        this.api = options.api
        this.providers = options.providers
        this.machineId = options.machineId
        this.host = options.host
        this.pollIntervalMs = options.pollIntervalMs ?? 30_000
        this.now = options.now ?? (() => Date.now())
        this.nextPollDelayMs = this.pollIntervalMs
    }

    start(): void {
        if (this.running) {
            return
        }

        this.running = true
        this.scheduleNextSync(0)
    }

    stop(): void {
        this.running = false
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
    }

    async syncOnce(): Promise<void> {
        if (this.running && this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }

        if (this.syncInFlight) {
            await this.syncInFlight
            return
        }

        this.syncInFlight = this.runSyncOnce()
            .then((nextPollDelayMs) => {
                this.nextPollDelayMs = nextPollDelayMs
            })
            .finally(() => {
                this.syncInFlight = null
                if (this.running && !this.timer) {
                    this.scheduleNextSync(this.nextPollDelayMs)
                }
            })

        await this.syncInFlight
    }

    private scheduleNextSync(delayMs: number): void {
        if (!this.running) {
            return
        }

        if (this.timer) {
            clearTimeout(this.timer)
        }

        this.timer = setTimeout(() => {
            this.timer = null
            void this.syncOnce().catch(() => undefined)
        }, Math.max(0, delayMs))
        this.timer.unref?.()
    }

    private async runSyncOnce(): Promise<number> {
        const summariesToTrack: NativeSessionSummary[] = []
        const seenSessionKeys = new Set<string>()
        const startedAt = this.now()

        for (const provider of this.providers) {
            let summaries: NativeSessionSummary[]
            try {
                summaries = await provider.discoverSessions()
            } catch {
                continue
            }

            for (const summary of summaries) {
                const sessionKey = this.getSessionSyncKey(summary)
                seenSessionKeys.add(sessionKey)
                summariesToTrack.push(summary)

                if (!this.shouldSyncSession(summary, startedAt)) {
                    continue
                }

                try {
                    await this.syncSession(provider, summary)
                } catch {
                } finally {
                    this.lastSessionSyncAt.set(sessionKey, this.now())
                }
            }
        }

        for (const sessionKey of this.lastSessionSyncAt.keys()) {
            if (!seenSessionKeys.has(sessionKey)) {
                this.lastSessionSyncAt.delete(sessionKey)
            }
        }

        return this.resolveNextPollDelay(summariesToTrack, this.now())
    }

    private async syncSession(provider: NativeSyncProvider, summary: NativeSessionSummary): Promise<void> {
        const session = await this.api.upsertNativeSession({
            tag: buildStableNativeTag(summary),
            metadata: this.buildSessionMetadata(summary),
            agentState: null
        })
        const state = await this.api.getNativeSyncState(session.id)

        try {
            const batch = await provider.readMessages(summary, state)
            const messages = batch.messages.map((message) => ({
                ...message,
                sourceProvider: summary.provider,
                sourceSessionId: summary.nativeSessionId
            }))

            if (messages.length > 0) {
                await this.importMessagesInChunks(session.id, messages)
            }

            await this.api.updateNativeSyncState({
                sessionId: session.id,
                provider: summary.provider,
                nativeSessionId: summary.nativeSessionId,
                machineId: this.machineId,
                cursor: batch.cursor,
                filePath: batch.filePath ?? state?.filePath ?? null,
                mtime: batch.mtime ?? state?.mtime ?? null,
                lastSyncedAt: this.now(),
                syncStatus: 'healthy',
                lastError: null
            })
        } catch (error) {
            await this.api.updateNativeSyncState({
                sessionId: session.id,
                provider: summary.provider,
                nativeSessionId: summary.nativeSessionId,
                machineId: this.machineId,
                cursor: state?.cursor ?? null,
                filePath: state?.filePath ?? null,
                mtime: state?.mtime ?? null,
                lastSyncedAt: this.now(),
                syncStatus: 'error',
                lastError: error instanceof Error ? error.message : String(error)
            })
        }
    }

    private buildSessionMetadata(summary: NativeSessionSummary): Record<string, unknown> {
        const metadata: Record<string, unknown> = {
            path: summary.projectPath,
            host: this.host,
            name: summary.title,
            machineId: this.machineId,
            flavor: summary.flavor,
            source: 'native',
            nativeProvider: summary.provider,
            nativeSessionId: summary.nativeSessionId,
            nativeProjectPath: summary.projectPath,
            nativeDiscoveredAt: summary.discoveredAt
        }

        if (summary.flavor === 'claude') {
            metadata.claudeSessionId = summary.nativeSessionId
        }

        if (summary.flavor === 'codex') {
            metadata.codexSessionId = summary.nativeSessionId
        }

        return metadata
    }

    private async importMessagesInChunks(sessionId: string, messages: NativeMessageImport[]): Promise<void> {
        let currentChunk: NativeMessageImport[] = []
        let currentBytes = this.baseImportPayloadBytes()

        for (const message of messages) {
            const messageBytes = this.messageImportBytes(message)

            if (currentChunk.length > 0 && currentBytes + messageBytes > NativeSyncService.MAX_IMPORT_BATCH_BYTES) {
                await this.api.importNativeMessages(sessionId, currentChunk)
                currentChunk = []
                currentBytes = this.baseImportPayloadBytes()
            }

            currentChunk.push(message)
            currentBytes += messageBytes
        }

        if (currentChunk.length > 0) {
            await this.api.importNativeMessages(sessionId, currentChunk)
        }
    }

    private baseImportPayloadBytes(): number {
        return Buffer.byteLength('{"messages":[]}', 'utf8')
    }

    private messageImportBytes(message: NativeMessageImport): number {
        return Buffer.byteLength(JSON.stringify(message), 'utf8') + 1
    }

    private getSessionSyncKey(summary: NativeSessionSummary): string {
        return `${summary.provider}:${summary.nativeSessionId}`
    }

    private shouldSyncSession(summary: NativeSessionSummary, now: number): boolean {
        const lastSyncAt = this.lastSessionSyncAt.get(this.getSessionSyncKey(summary))
        if (lastSyncAt === undefined) {
            return true
        }

        return now - lastSyncAt >= this.resolveSessionSyncInterval(summary.lastActivityAt, now)
    }

    private resolveNextPollDelay(summaries: NativeSessionSummary[], now: number): number {
        if (summaries.length === 0) {
            return Math.max(this.pollIntervalMs, NativeSyncService.IDLE_POLL_INTERVAL_MS)
        }

        let nextDelayMs = Math.max(this.pollIntervalMs, NativeSyncService.IDLE_POLL_INTERVAL_MS)

        for (const summary of summaries) {
            const intervalMs = this.resolveSessionSyncInterval(summary.lastActivityAt, now)
            const lastSyncAt = this.lastSessionSyncAt.get(this.getSessionSyncKey(summary))
            if (lastSyncAt === undefined) {
                return 0
            }

            const remainingMs = Math.max(0, intervalMs - (now - lastSyncAt))
            nextDelayMs = Math.min(nextDelayMs, remainingMs === 0 ? intervalMs : remainingMs)
        }

        return nextDelayMs
    }

    private resolveSessionSyncInterval(latestActivityAt: number, now: number = this.now()): number {
        const ageMs = Math.max(0, now - latestActivityAt)
        if (ageMs <= NativeSyncService.ACTIVE_ACTIVITY_WINDOW_MS) {
            return Math.min(this.pollIntervalMs, NativeSyncService.ACTIVE_POLL_INTERVAL_MS)
        }
        if (ageMs <= NativeSyncService.WARM_ACTIVITY_WINDOW_MS) {
            return this.pollIntervalMs
        }
        return Math.max(this.pollIntervalMs, NativeSyncService.IDLE_POLL_INTERVAL_MS)
    }
}
