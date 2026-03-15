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
    private readonly api: NativeSyncApi
    private readonly providers: NativeSyncProvider[]
    private readonly machineId: string
    private readonly host: string
    private readonly pollIntervalMs: number
    private readonly now: () => number
    private timer: NodeJS.Timeout | null = null
    private syncInFlight: Promise<void> | null = null

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
    }

    start(): void {
        if (this.timer) {
            return
        }

        void this.syncOnce().catch(() => undefined)
        this.timer = setInterval(() => {
            void this.syncOnce().catch(() => undefined)
        }, this.pollIntervalMs)
    }

    stop(): void {
        if (!this.timer) {
            return
        }

        clearInterval(this.timer)
        this.timer = null
    }

    async syncOnce(): Promise<void> {
        if (this.syncInFlight) {
            await this.syncInFlight
            return
        }

        this.syncInFlight = this.runSyncOnce().finally(() => {
            this.syncInFlight = null
        })

        await this.syncInFlight
    }

    private async runSyncOnce(): Promise<void> {
        for (const provider of this.providers) {
            let summaries: NativeSessionSummary[]
            try {
                summaries = await provider.discoverSessions()
            } catch {
                continue
            }

            for (const summary of summaries) {
                try {
                    await this.syncSession(provider, summary)
                } catch {
                    continue
                }
            }
        }
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
                await this.api.importNativeMessages(session.id, messages)
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
}
