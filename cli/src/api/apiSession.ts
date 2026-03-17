import { EventEmitter } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { io, type Socket } from 'socket.io-client'
import axios from 'axios'
import type { ZodType } from 'zod'
import { logger } from '@/ui/logger'
import { backoff } from '@/utils/time'
import { apiValidationError } from '@/utils/errorUtils'
import { AsyncLock } from '@/utils/lock'
import type { RawJSONLines } from '@/claude/types'
import { configuration } from '@/configuration'
import type {
    ClientToServerEvents,
    RawEventEnvelope,
    RawEventProvider,
    RuntimeRawEventPayload,
    ServerToClientEvents,
    Update
} from '@hapi/protocol'
import {
    createSessionTitleSummary,
    TerminalClosePayloadSchema,
    TerminalOpenPayloadSchema,
    TerminalResizePayloadSchema,
    TerminalWritePayloadSchema
} from '@hapi/protocol'
import type {
    AgentState,
    MessageMeta,
    Metadata,
    Session,
    SessionModelMode,
    SessionPermissionMode,
    UserMessage
} from './types'
import { AgentStateSchema, CliMessagesResponseSchema, MetadataSchema, UserMessageSchema } from './types'
import { RpcHandlerManager } from './rpc/RpcHandlerManager'
import { registerCommonHandlers } from '../modules/common/registerCommonHandlers'
import { cleanupUploadDir } from '../modules/common/handlers/uploads'
import { TerminalManager } from '@/terminal/TerminalManager'
import { applyVersionedAck } from './versionedUpdate'

type RuntimeProvider = Extract<RawEventProvider, 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode'>

type RuntimeLogicalIdentity = {
    sourceKey: string
    observationKey: string | null
}

const SYNTHETIC_RUNTIME_ID_RAW_TYPES = new Set([
    'message',
    'reasoning',
    'reasoning-delta',
    'token_count',
    'tool-call',
    'tool-call-result',
    'tool_result',
    'plan',
    'error'
])

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }

    return value as Record<string, unknown>
}

function asNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function pickFirstString(
    record: Record<string, unknown> | null,
    keys: readonly string[]
): string | null {
    if (!record) {
        return null
    }

    for (const key of keys) {
        const value = asNonEmptyString(record[key])
        if (value) {
            return value
        }
    }

    return null
}

function isRuntimeProvider(value: string | null | undefined): value is RuntimeProvider {
    return value === 'claude' || value === 'codex' || value === 'gemini' || value === 'cursor' || value === 'opencode'
}

function parseRuntimeTimestamp(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.trunc(value)
    }

    if (typeof value !== 'string' || value.length === 0) {
        return null
    }

    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric >= 0) {
        return Math.trunc(numeric)
    }

    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null
    }

    return Math.trunc(parsed)
}

function buildRuntimeRawEventId(
    identity: Pick<RawEventEnvelope, 'provider' | 'source' | 'sourceSessionId' | 'sourceKey'>
): string {
    return createHash('sha1')
        .update([
            identity.provider,
            identity.source,
            identity.sourceSessionId,
            identity.sourceKey
        ].join('|'))
        .digest('hex')
}

export class ApiSessionClient extends EventEmitter {
    private readonly token: string
    readonly sessionId: string
    private metadata: Metadata | null
    private metadataVersion: number
    private agentState: AgentState | null
    private agentStateVersion: number
    private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>
    private pendingMessages: UserMessage[] = []
    private pendingMessageCallback: ((message: UserMessage) => void) | null = null
    private lastSeenMessageSeq: number | null = null
    private backfillInFlight: Promise<void> | null = null
    private needsBackfill = false
    private hasConnectedOnce = false
    readonly rpcHandlerManager: RpcHandlerManager
    private readonly terminalManager: TerminalManager
    private agentStateLock = new AsyncLock()
    private metadataLock = new AsyncLock()
    private runtimeSourceOrder = 0
    private lastKeepAliveState: {
        thinking: boolean
        mode?: 'local' | 'remote'
        runtime?: { permissionMode?: SessionPermissionMode; modelMode?: SessionModelMode }
    }

    constructor(token: string, session: Session) {
        super()
        this.token = token
        this.sessionId = session.id
        this.metadata = session.metadata
        this.metadataVersion = session.metadataVersion
        this.agentState = session.agentState
        this.agentStateVersion = session.agentStateVersion
        this.lastKeepAliveState = {
            thinking: session.thinking
        }

        this.rpcHandlerManager = new RpcHandlerManager({
            scopePrefix: this.sessionId,
            logger: (msg, data) => logger.debug(msg, data)
        })

        if (this.metadata?.path) {
            registerCommonHandlers(this.rpcHandlerManager, this.metadata.path)
        }

        this.socket = io(`${configuration.apiUrl}/cli`, {
            auth: {
                token: this.token,
                clientType: 'session-scoped' as const,
                sessionId: this.sessionId
            },
            path: '/socket.io/',
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['websocket'],
            autoConnect: false
        })

        this.terminalManager = new TerminalManager({
            sessionId: this.sessionId,
            getSessionPath: () => this.metadata?.path ?? null,
            onReady: (payload) => this.socket.emit('terminal:ready', payload),
            onOutput: (payload) => this.socket.emit('terminal:output', payload),
            onExit: (payload) => this.socket.emit('terminal:exit', payload),
            onError: (payload) => this.socket.emit('terminal:error', payload)
        })

        this.socket.on('connect', () => {
            logger.debug('Socket connected successfully')
            this.rpcHandlerManager.onSocketConnect(this.socket)
            if (this.hasConnectedOnce) {
                this.needsBackfill = true
            }
            void this.backfillIfNeeded()
            this.hasConnectedOnce = true
            this.socket.emit('session-alive', {
                sid: this.sessionId,
                time: Date.now(),
                thinking: this.lastKeepAliveState.thinking,
                ...(this.lastKeepAliveState.mode ? { mode: this.lastKeepAliveState.mode } : {}),
                ...(this.lastKeepAliveState.runtime ?? {})
            })
        })

        this.socket.on('rpc-request', async (data: { method: string; params: string }, callback: (response: string) => void) => {
            callback(await this.rpcHandlerManager.handleRequest(data))
        })

        this.socket.on('disconnect', (reason) => {
            logger.debug('[API] Socket disconnected:', reason)
            this.rpcHandlerManager.onSocketDisconnect()
            this.terminalManager.closeAll()
            if (this.hasConnectedOnce) {
                this.needsBackfill = true
            }
        })

        this.socket.on('connect_error', (error) => {
            logger.debug('[API] Socket connection error:', error)
            this.rpcHandlerManager.onSocketDisconnect()
        })

        this.socket.on('error', (payload) => {
            logger.debug('[API] Socket error:', payload)
        })

        const handleTerminalEvent = <T extends { sessionId: string }>(
            schema: ZodType<T>,
            handler: (payload: T) => void
        ) => (data: unknown) => {
            const parsed = schema.safeParse(data)
            if (!parsed.success) {
                return
            }
            if (parsed.data.sessionId !== this.sessionId) {
                return
            }
            handler(parsed.data)
        }

        this.socket.on('terminal:open', handleTerminalEvent(TerminalOpenPayloadSchema, (payload) => {
            this.terminalManager.create(payload.terminalId, payload.cols, payload.rows)
        }))

        this.socket.on('terminal:write', handleTerminalEvent(TerminalWritePayloadSchema, (payload) => {
            this.terminalManager.write(payload.terminalId, payload.data)
        }))

        this.socket.on('terminal:resize', handleTerminalEvent(TerminalResizePayloadSchema, (payload) => {
            this.terminalManager.resize(payload.terminalId, payload.cols, payload.rows)
        }))

        this.socket.on('terminal:close', handleTerminalEvent(TerminalClosePayloadSchema, (payload) => {
            this.terminalManager.close(payload.terminalId)
        }))

        this.socket.on('update', (data: Update) => {
            try {
                if (!data.body) return

                if (data.body.t === 'new-message') {
                    this.handleIncomingMessage(data.body.message)
                    return
                }

                if (data.body.t === 'update-session') {
                    if (data.body.metadata && data.body.metadata.version > this.metadataVersion) {
                        const parsed = MetadataSchema.safeParse(data.body.metadata.value)
                        if (parsed.success) {
                            this.metadata = parsed.data
                        } else {
                            logger.debug('[API] Ignoring invalid metadata update', { version: data.body.metadata.version })
                        }
                        this.metadataVersion = data.body.metadata.version
                    }
                    if (data.body.agentState && data.body.agentState.version > this.agentStateVersion) {
                        const next = data.body.agentState.value
                        if (next == null) {
                            this.agentState = null
                        } else {
                            const parsed = AgentStateSchema.safeParse(next)
                            if (parsed.success) {
                                this.agentState = parsed.data
                            } else {
                                logger.debug('[API] Ignoring invalid agentState update', { version: data.body.agentState.version })
                            }
                        }
                        this.agentStateVersion = data.body.agentState.version
                    }
                    return
                }

                this.emit('message', data.body)
            } catch (error) {
                logger.debug('[SOCKET] [UPDATE] [ERROR] Error handling update', { error })
            }
        })

        this.socket.connect()
    }

    onUserMessage(callback: (data: UserMessage) => void): void {
        this.pendingMessageCallback = callback
        while (this.pendingMessages.length > 0) {
            callback(this.pendingMessages.shift()!)
        }
    }

    private enqueueUserMessage(message: UserMessage): void {
        if (this.pendingMessageCallback) {
            this.pendingMessageCallback(message)
        } else {
            this.pendingMessages.push(message)
        }
    }

    private handleIncomingMessage(message: { seq?: number; content: unknown }): void {
        const seq = typeof message.seq === 'number' ? message.seq : null
        if (seq !== null) {
            if (this.lastSeenMessageSeq !== null && seq <= this.lastSeenMessageSeq) {
                return
            }
            this.lastSeenMessageSeq = seq
        }

        const userResult = UserMessageSchema.safeParse(message.content)
        if (userResult.success) {
            this.enqueueUserMessage(userResult.data)
            return
        }

        this.emit('message', message.content)
    }

    private async backfillIfNeeded(): Promise<void> {
        if (!this.needsBackfill) {
            return
        }
        try {
            await this.backfillMessages()
            this.needsBackfill = false
        } catch (error) {
            logger.debug('[API] Backfill failed', error)
            this.needsBackfill = true
        }
    }

    private async backfillMessages(): Promise<void> {
        if (this.backfillInFlight) {
            await this.backfillInFlight
            return
        }

        const startSeq = this.lastSeenMessageSeq
        if (startSeq === null) {
            logger.debug('[API] Skipping backfill because no last-seen message sequence is available')
            return
        }

        const limit = 200
        const run = async () => {
            let cursor = startSeq
            while (true) {
                const response = await axios.get(
                    `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(this.sessionId)}/messages`,
                    {
                        params: { afterSeq: cursor, limit },
                        headers: {
                            Authorization: `Bearer ${this.token}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15_000
                    }
                )

                const parsed = CliMessagesResponseSchema.safeParse(response.data)
                if (!parsed.success) {
                    throw apiValidationError('Invalid /cli/sessions/:id/messages response', response)
                }

                const messages = parsed.data.messages
                if (messages.length === 0) {
                    break
                }

                let maxSeq = cursor
                for (const message of messages) {
                    if (typeof message.seq === 'number') {
                        if (message.seq > maxSeq) {
                            maxSeq = message.seq
                        }
                    }
                    this.handleIncomingMessage(message)
                }

                const observedSeq = this.lastSeenMessageSeq ?? maxSeq
                const nextCursor = Math.max(maxSeq, observedSeq)
                if (nextCursor <= cursor) {
                    logger.debug('[API] Backfill stopped due to non-advancing cursor', {
                        cursor,
                        maxSeq,
                        observedSeq
                    })
                    break
                }

                cursor = nextCursor
                if (messages.length < limit) {
                    break
                }
            }
        }

        this.backfillInFlight = run().finally(() => {
            this.backfillInFlight = null
        })

        await this.backfillInFlight
    }

    private nextRuntimeSourceOrder(): number {
        const current = this.runtimeSourceOrder
        this.runtimeSourceOrder += 1
        return current
    }

    private getRuntimeMetadataSessionId(provider: RuntimeProvider): string | null {
        const metadata = this.metadata
        if (!metadata) {
            return null
        }

        if (provider === 'claude') {
            return metadata.claudeSessionId ?? null
        }
        if (provider === 'codex') {
            return metadata.codexSessionId ?? null
        }
        if (provider === 'gemini') {
            return metadata.geminiSessionId ?? null
        }
        if (provider === 'cursor') {
            return metadata.cursorSessionId ?? null
        }
        if (provider === 'opencode') {
            return metadata.opencodeSessionId ?? null
        }

        return null
    }

    private resolveRuntimeSourceSessionId(provider: RuntimeProvider, body: unknown): string {
        const record = asRecord(body)
        const keys = provider === 'claude'
            ? ['sessionId', 'session_id']
            : ['sessionId', 'session_id', 'threadId', 'thread_id']

        return pickFirstString(record, keys)
            ?? this.getRuntimeMetadataSessionId(provider)
            ?? this.sessionId
    }

    private resolveRuntimeOccurredAt(body: unknown): number {
        const record = asRecord(body)
        return parseRuntimeTimestamp(
            record?.timestamp
            ?? record?.createdAt
            ?? record?.created_at
            ?? record?.time
        ) ?? Date.now()
    }

    private resolveRuntimeRawType(body: unknown): string {
        const record = asRecord(body)
        return asNonEmptyString(record?.type) ?? 'unknown'
    }

    private resolveClaudeRuntimeChannel(rawType: string): string {
        return rawType === 'event' ? 'claude:runtime:events' : 'claude:runtime:messages'
    }

    private resolveRuntimeChannel(provider: RuntimeProvider, rawType: string): string {
        if (provider === 'claude') {
            return this.resolveClaudeRuntimeChannel(rawType)
        }

        return `${provider}:runtime`
    }

    private shouldUseGenericRuntimeId(rawType: string): boolean {
        return !SYNTHETIC_RUNTIME_ID_RAW_TYPES.has(rawType)
    }

    private extractRuntimeLogicalIdentity(provider: RuntimeProvider, rawType: string, body: unknown): RuntimeLogicalIdentity | null {
        const record = asRecord(body)
        if (!record) {
            return null
        }

        const uuid = pickFirstString(record, ['uuid'])
        if (uuid) {
            return {
                sourceKey: `uuid:${uuid}`,
                observationKey: `${provider}:uuid:${uuid}`
            }
        }

        const callId = pickFirstString(record, ['call_id', 'callId', 'tool_call_id', 'toolCallId'])
        if (callId) {
            return {
                sourceKey: `call_id:${callId}`,
                observationKey: `${provider}:call_id:${callId}`
            }
        }

        const responseId = pickFirstString(record, ['response_id', 'responseId'])
        if (responseId) {
            return {
                sourceKey: `response_id:${responseId}`,
                observationKey: `${provider}:response_id:${responseId}`
            }
        }

        const leafUuid = pickFirstString(record, ['leafUuid'])
        if (leafUuid) {
            return {
                sourceKey: `leafUuid:${leafUuid}`,
                observationKey: null
            }
        }

        const id = pickFirstString(record, ['id'])
        if (id && this.shouldUseGenericRuntimeId(rawType)) {
            return {
                sourceKey: `id:${id}`,
                observationKey: `${provider}:id:${id}`
            }
        }

        return null
    }

    private emitRuntimeEvent(provider: RuntimeProvider, body: unknown): void {
        const rawType = this.resolveRuntimeRawType(body)
        const sourceOrder = this.nextRuntimeSourceOrder()
        const sourceSessionId = this.resolveRuntimeSourceSessionId(provider, body)
        const identity = this.extractRuntimeLogicalIdentity(provider, rawType, body)
        const sourceKey = identity?.sourceKey ?? `runtime:${sourceOrder}:${rawType}`
        const source = 'runtime' as const
        const event: RuntimeRawEventPayload['event'] = {
            id: buildRuntimeRawEventId({
                provider,
                source,
                sourceSessionId,
                sourceKey
            }),
            provider,
            source,
            sourceSessionId,
            sourceKey,
            observationKey: identity?.observationKey ?? null,
            channel: this.resolveRuntimeChannel(provider, rawType),
            sourceOrder,
            occurredAt: this.resolveRuntimeOccurredAt(body),
            ingestedAt: Date.now(),
            rawType,
            payload: body,
            ingestSchemaVersion: 1
        }

        this.socket.emit('runtime-event', {
            sid: this.sessionId,
            event
        })
    }

    private resolveCodexFamilyProvider(): RuntimeProvider {
        const flavor = this.metadata?.flavor
        return isRuntimeProvider(flavor) && flavor !== 'claude'
            ? flavor
            : 'codex'
    }

    private resolveDefaultRuntimeProvider(): RuntimeProvider {
        const flavor = this.metadata?.flavor
        return isRuntimeProvider(flavor)
            ? flavor
            : 'claude'
    }

    sendClaudeSessionMessage(body: RawJSONLines): void {
        this.emitRuntimeEvent('claude', body)

        if (body.type === 'summary' && 'summary' in body && 'leafUuid' in body) {
            this.updateMetadata((metadata) => ({
                ...metadata,
                summary: createSessionTitleSummary(body.summary, Date.now(), 'generated')
            }))
        }
    }

    sendUserMessage(text: string, meta?: MessageMeta): void {
        if (!text) {
            return
        }

        this.emitRuntimeEvent(this.resolveDefaultRuntimeProvider(), {
            type: 'user',
            role: 'user',
            content: {
                type: 'text',
                text
            },
            meta: {
                sentFrom: 'cli',
                ...(meta ?? {})
            }
        })
    }

    sendCodexMessage(body: unknown): void {
        this.emitRuntimeEvent(this.resolveCodexFamilyProvider(), body)
    }

    sendSessionEvent(event: {
        type: 'switch'
        mode: 'local' | 'remote'
    } | {
        type: 'message'
        message: string
    } | {
        type: 'permission-mode-changed'
        mode: SessionPermissionMode
    } | {
        type: 'ready'
    }, id?: string): void {
        if (event.type === 'message') {
            this.emitRuntimeEvent(this.resolveDefaultRuntimeProvider(), event)
            return
        }

        const provider = this.resolveDefaultRuntimeProvider()
        const body = event.type === 'switch'
            ? {
                ...event,
                id: id ?? randomUUID(),
                summary: `Switched to ${event.mode} mode`
            }
            : event.type === 'permission-mode-changed'
                ? {
                    ...event,
                    id: id ?? randomUUID(),
                    summary: `Permission mode changed to ${event.mode}`
                }
                : {
                    ...event,
                    id: id ?? randomUUID(),
                    summary: 'Session ready'
                }

        this.emitRuntimeEvent(provider, body)
    }

    keepAlive(
        thinking: boolean,
        mode: 'local' | 'remote',
        runtime?: { permissionMode?: SessionPermissionMode; modelMode?: SessionModelMode }
    ): void {
        this.lastKeepAliveState = {
            thinking,
            mode,
            runtime
        }
        this.socket.volatile.emit('session-alive', {
            sid: this.sessionId,
            time: Date.now(),
            thinking,
            mode,
            ...(runtime ?? {})
        })
    }

    sendSessionDeath(): void {
        void cleanupUploadDir(this.sessionId)
        this.socket.emit('session-end', { sid: this.sessionId, time: Date.now() })
    }

    updateMetadata(handler: (metadata: Metadata) => Metadata): void {
        this.metadataLock.inLock(async () => {
            await backoff(async () => {
                const current = this.metadata ?? ({} as Metadata)
                const updated = handler(current)

                const answer = await this.socket.emitWithAck('update-metadata', {
                    sid: this.sessionId,
                    expectedVersion: this.metadataVersion,
                    metadata: updated
                }) as unknown

                applyVersionedAck(answer, {
                    valueKey: 'metadata',
                    parseValue: (value) => {
                        const parsed = MetadataSchema.safeParse(value)
                        return parsed.success ? parsed.data : null
                    },
                    applyValue: (value) => {
                        this.metadata = value
                    },
                    applyVersion: (version) => {
                        this.metadataVersion = version
                    },
                    logInvalidValue: (context, version) => {
                        const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                        logger.debug(`[API] Ignoring invalid metadata value from ${suffix}`, { version })
                    },
                    invalidResponseMessage: 'Invalid update-metadata response',
                    errorMessage: 'Metadata update failed',
                    versionMismatchMessage: 'Metadata version mismatch'
                })
            })
        })
    }

    updateAgentState(handler: (state: AgentState) => AgentState): void {
        this.agentStateLock.inLock(async () => {
            await backoff(async () => {
                const current = this.agentState ?? ({} as AgentState)
                const updated = handler(current)

                const answer = await this.socket.emitWithAck('update-state', {
                    sid: this.sessionId,
                    expectedVersion: this.agentStateVersion,
                    agentState: updated
                }) as unknown

                applyVersionedAck(answer, {
                    valueKey: 'agentState',
                    parseValue: (value) => {
                        const parsed = AgentStateSchema.safeParse(value)
                        return parsed.success ? parsed.data : null
                    },
                    applyValue: (value) => {
                        this.agentState = value
                    },
                    applyVersion: (version) => {
                        this.agentStateVersion = version
                    },
                    logInvalidValue: (context, version) => {
                        const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                        logger.debug(`[API] Ignoring invalid agentState value from ${suffix}`, { version })
                    },
                    invalidResponseMessage: 'Invalid update-state response',
                    errorMessage: 'Agent state update failed',
                    versionMismatchMessage: 'Agent state version mismatch'
                })
            })
        })
    }

    private async waitForConnected(timeoutMs: number): Promise<boolean> {
        if (this.socket.connected) {
            return true
        }

        this.socket.connect()

        return await new Promise<boolean>((resolve) => {
            let settled = false

            const cleanup = () => {
                this.socket.off('connect', onConnect)
                clearTimeout(timeout)
            }

            const onConnect = () => {
                if (settled) return
                settled = true
                cleanup()
                resolve(true)
            }

            const timeout = setTimeout(() => {
                if (settled) return
                settled = true
                cleanup()
                resolve(false)
            }, Math.max(0, timeoutMs))

            this.socket.on('connect', onConnect)
        })
    }

    private async drainLock(lock: AsyncLock, timeoutMs: number): Promise<boolean> {
        if (timeoutMs <= 0) {
            return false
        }

        return await new Promise<boolean>((resolve) => {
            let settled = false
            let timeout: ReturnType<typeof setTimeout> | null = null

            const finish = (value: boolean) => {
                if (settled) return
                settled = true
                if (timeout) {
                    clearTimeout(timeout)
                }
                resolve(value)
            }

            timeout = setTimeout(() => finish(false), timeoutMs)

            lock.inLock(async () => { })
                .then(() => finish(true))
                .catch(() => finish(false))
        })
    }

    async flush(options?: { timeoutMs?: number }): Promise<void> {
        const deadlineMs = Date.now() + (options?.timeoutMs ?? 5_000)

        const remainingMs = () => Math.max(0, deadlineMs - Date.now())

        await this.drainLock(this.metadataLock, remainingMs())
        await this.drainLock(this.agentStateLock, remainingMs())

        if (remainingMs() === 0) {
            return
        }

        const connected = await this.waitForConnected(remainingMs())
        if (!connected) {
            return
        }

        const pingTimeoutMs = remainingMs()
        if (pingTimeoutMs === 0) {
            return
        }

        try {
            await this.socket.timeout(pingTimeoutMs).emitWithAck('ping')
        } catch {
            // best effort
        }
    }

    close(): void {
        this.rpcHandlerManager.onSocketDisconnect()
        this.terminalManager.closeAll()
        this.socket.disconnect()
    }
}
