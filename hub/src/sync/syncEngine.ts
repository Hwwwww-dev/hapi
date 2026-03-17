/**
 * Sync Engine for HAPI Telegram Bot (Direct Connect)
 *
 * In the direct-connect architecture:
 * - hapi-hub is the hub (Socket.IO + REST)
 * - hapi CLI connects directly to the hub (no relay)
 * - No E2E encryption; data is stored as JSON in SQLite
 */

import { isObject } from '@hapi/protocol'
import type { CanonicalMessagesPage, RawEventEnvelope } from '@hapi/protocol'
import type { DecryptedMessage, ModelMode, PermissionMode, Session, SyncEvent } from '@hapi/protocol/types'
import type { Server } from 'socket.io'
import type { Store, StoredNativeSyncState } from '../store'
import type { RpcRegistry } from '../socket/rpcRegistry'
import type { SSEManager } from '../sse/sseManager'
import { EventPublisher, type SyncEventListener } from './eventPublisher'
import { MachineCache, type Machine } from './machineCache'
import { MessageService } from './messageService'
import {
    type RpcCreateMachineDirectoryResponse,
    RpcGateway,
    type RpcCommandResponse,
    type RpcDeleteUploadResponse,
    type RpcListDirectoryResponse,
    type RpcPathExistsResponse,
    type RpcReadFileResponse,
    type RpcUploadFileResponse
} from './rpcGateway'
import { SessionCache } from './sessionCache'

export type { Session, SyncEvent } from '@hapi/protocol/types'
export type { Machine } from './machineCache'
export type { SyncEventListener } from './eventPublisher'
export type {
    RpcCommandResponse,
    RpcCreateMachineDirectoryResponse,
    RpcDeleteUploadResponse,
    RpcListDirectoryResponse,
    RpcPathExistsResponse,
    RpcReadFileResponse,
    RpcUploadFileResponse
} from './rpcGateway'

export type ResumeSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string; code: 'session_not_found' | 'access_denied' | 'no_machine_online' | 'resume_unavailable' | 'resume_failed' }

export class SyncEngine {
    private readonly store: Store
    private readonly eventPublisher: EventPublisher
    private readonly sessionCache: SessionCache
    private readonly machineCache: MachineCache
    private readonly messageService: MessageService
    private readonly rpcGateway: RpcGateway
    private inactivityTimer: NodeJS.Timeout | null = null

    constructor(
        store: Store,
        io: Server,
        rpcRegistry: RpcRegistry,
        sseManager: SSEManager
    ) {
        this.store = store
        this.eventPublisher = new EventPublisher(sseManager, (event) => this.resolveNamespace(event))
        this.sessionCache = new SessionCache(store, this.eventPublisher)
        this.machineCache = new MachineCache(store, this.eventPublisher)
        this.messageService = new MessageService(
            store,
            io,
            this.eventPublisher,
            (sessionId) => {
                this.sessionCache.refreshSession(sessionId)
            }
        )
        this.rpcGateway = new RpcGateway(io, rpcRegistry)
        this.reloadAll()
        this.inactivityTimer = setInterval(() => this.expireInactive(), 5_000)
    }

    stop(): void {
        if (this.inactivityTimer) {
            clearInterval(this.inactivityTimer)
            this.inactivityTimer = null
        }
    }

    subscribe(listener: SyncEventListener): () => void {
        return this.eventPublisher.subscribe(listener)
    }

    private resolveNamespace(event: SyncEvent): string | undefined {
        if (event.namespace) {
            return event.namespace
        }
        if ('sessionId' in event) {
            return this.getSession(event.sessionId)?.namespace
        }
        if ('machineId' in event) {
            return this.machineCache.getMachine(event.machineId)?.namespace
        }
        return undefined
    }

    getSessions(): Session[] {
        return this.sessionCache.getSessions()
    }

    getSessionsByNamespace(namespace: string): Session[] {
        return this.sessionCache.getSessionsByNamespace(namespace)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessionCache.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId) ?? undefined
    }

    getSessionByNamespace(sessionId: string, namespace: string): Session | undefined {
        const session = this.sessionCache.getSessionByNamespace(sessionId, namespace)
            ?? this.sessionCache.refreshSession(sessionId)
        if (!session || session.namespace !== namespace) {
            return undefined
        }
        return session
    }

    resolveSessionAccess(
        sessionId: string,
        namespace: string
    ): { ok: true; sessionId: string; session: Session } | { ok: false; reason: 'not-found' | 'access-denied' } {
        return this.sessionCache.resolveSessionAccess(sessionId, namespace)
    }

    getActiveSessions(): Session[] {
        return this.sessionCache.getActiveSessions()
    }

    getMachines(): Machine[] {
        return this.machineCache.getMachines()
    }

    getMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getMachinesByNamespace(namespace)
    }

    getMachine(machineId: string): Machine | undefined {
        return this.machineCache.getMachine(machineId)
    }

    getMachineByNamespace(machineId: string, namespace: string): Machine | undefined {
        return this.machineCache.getMachineByNamespace(machineId, namespace)
    }

    getOnlineMachines(): Machine[] {
        return this.machineCache.getOnlineMachines()
    }

    getOnlineMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getOnlineMachinesByNamespace(namespace)
    }

    getCliBackfillMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        return this.messageService.getCliBackfillMessagesAfter(sessionId, options)
    }

    getCanonicalMessagesPage(sessionId: string, options: {
        generation: number | null
        beforeTimelineSeq: number | null
        limit: number
    }): CanonicalMessagesPage {
        return this.messageService.getCanonicalMessagesPage(sessionId, options)
    }

    getCanonicalLatestStreamSeq(sessionId: string): number {
        return this.messageService.getCanonicalLatestStreamSeq(sessionId)
    }

    async ingestRawEvents(sessionId: string, events: RawEventEnvelope[]) {
        return await this.messageService.ingestRawEvents(sessionId, events)
    }

    async rebuildSessionCanonicalState(sessionId: string) {
        return await this.messageService.rebuildSessionCanonicalState(sessionId)
    }

    handleRealtimeEvent(event: SyncEvent): void {
        if (event.type === 'session-updated' && event.sessionId) {
            this.sessionCache.refreshSession(event.sessionId)
            return
        }

        if (event.type === 'machine-updated' && event.machineId) {
            this.machineCache.refreshMachine(event.machineId)
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            if (!this.getSession(event.sessionId)) {
                this.sessionCache.refreshSession(event.sessionId)
            }
        }

        this.eventPublisher.emit(event)
    }

    handleSessionAlive(payload: {
        sid: string
        time: number
        thinking?: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        modelMode?: ModelMode
    }): void {
        this.sessionCache.handleSessionAlive(payload)

        const session = this.getSession(payload.sid)
        if (!session?.metadata || session.metadata.source !== 'native') {
            return
        }

        const hybridMetadata = this.buildHybridSessionMetadata(session.metadata, session.metadata)
        this.updateSessionMetadataIfNeeded(session, hybridMetadata)
    }

    handleSessionEnd(payload: { sid: string; time: number }): void {
        this.sessionCache.handleSessionEnd(payload)
    }

    handleMachineAlive(payload: { machineId: string; time: number }): void {
        this.machineCache.handleMachineAlive(payload)
    }

    private expireInactive(): void {
        this.sessionCache.expireInactive()
        this.machineCache.expireInactive()
    }

    private reloadAll(): void {
        this.sessionCache.reloadAll()
        this.machineCache.reloadAll()
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string): Session {
        return this.sessionCache.getOrCreateSession(tag, metadata, agentState, namespace)
    }

    upsertNativeSession(payload: {
        tag: string
        namespace: string
        metadata: unknown
        createdAt: number
        lastActivityAt: number
        agentState?: unknown | null
    }): Session {
        const nativeIdentity = this.resolveNativeSessionIdentity(payload.metadata)
        const aliasMatchedSession = nativeIdentity
            ? this.resolveSessionByNativeAlias(payload.namespace, nativeIdentity.provider, nativeIdentity.nativeSessionId)
            : null
        const matchingSessions = nativeIdentity
            ? this.getSessionsByNamespace(payload.namespace).filter((session) => this.sessionMatchesNativeIdentity(session, nativeIdentity))
            : []

        if (aliasMatchedSession && !matchingSessions.some((session) => session.id === aliasMatchedSession.id)) {
            matchingSessions.push(aliasMatchedSession)
        }

        const session = this.pickCanonicalNativeSession(matchingSessions)
            ?? this.sessionCache.getOrCreateSession(
                payload.tag,
                payload.metadata,
                payload.agentState ?? null,
                payload.namespace
            )

        let current = this.getSession(session.id) ?? session
        current = this.updateSessionMetadataIfNeeded(
            current,
            this.mergeIncomingNativeMetadata(current, payload.metadata)
        )
        current = this.updateSessionAgentStateIfNeeded(
            current,
            this.mergeNativeSessionAgentState(current.agentState, payload.agentState)
        )
        current = this.reconcileSessionTimestamps(
            current,
            Math.min(current.createdAt, payload.createdAt),
            current.metadata?.source === 'native'
                ? payload.lastActivityAt
                : Math.max(current.updatedAt, payload.lastActivityAt)
        )

        for (const matchingSession of matchingSessions) {
            if (matchingSession.id === current.id) {
                continue
            }
            if (matchingSession.metadata?.source !== 'native') {
                continue
            }
            this.dropSessionIfPresent(matchingSession.id, payload.namespace)
        }

        return this.getSession(current.id) ?? current
    }

    getNativeSyncState(sessionId: string): StoredNativeSyncState | null {
        return this.store.nativeSyncState.getBySessionId(sessionId)
    }

    updateNativeSyncState(payload: StoredNativeSyncState): (
        | { ok: true; state: StoredNativeSyncState }
        | { ok: false; status: 404 | 409; error: string }
    ) {
        const session = this.getSession(payload.sessionId)
        if (!session?.metadata) {
            return { ok: false, status: 404, error: 'Session not found' }
        }

        if (session.metadata.nativeProvider !== payload.provider) {
            return { ok: false, status: 409, error: 'Native provider does not match session metadata' }
        }

        if (session.metadata.nativeSessionId !== payload.nativeSessionId) {
            return { ok: false, status: 409, error: 'Native session ID does not match session metadata' }
        }

        const state = this.store.nativeSyncState.upsert(payload)
        if (payload.syncStatus === 'healthy' && payload.lastSyncedAt !== null) {
            this.updateSessionMetadataIfNeeded(session, {
                ...session.metadata,
                nativeLastSyncedAt: payload.lastSyncedAt
            }, { touchUpdatedAt: false })
        }

        return { ok: true, state }
    }

    markNativeSyncError(sessionId: string, message: string, timestamp: number): StoredNativeSyncState | null {
        return this.store.nativeSyncState.markError(sessionId, message, timestamp)
    }

    getOrCreateMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string): Machine {
        return this.machineCache.getOrCreateMachine(id, metadata, runnerState, namespace)
    }

    async sendMessage(
        sessionId: string,
        payload: {
            text: string
            localId?: string | null
            attachments?: Array<{
                id: string
                filename: string
                mimeType: string
                size: number
                path: string
                previewUrl?: string
            }>
            sentFrom?: 'telegram-bot' | 'webapp'
        }
    ): Promise<void> {
        await this.messageService.sendMessage(sessionId, payload)
    }

    private updateSessionMetadataIfNeeded(
        session: Session,
        metadata: unknown,
        options?: { touchUpdatedAt?: boolean }
    ): Session {
        if (JSON.stringify(session.metadata) === JSON.stringify(metadata)) {
            this.store.sessions.syncNativeAliasesForSessionMetadata(session.id, session.namespace, metadata)
            return session
        }

        const result = this.store.sessions.updateSessionMetadata(
            session.id,
            metadata,
            session.metadataVersion,
            session.namespace,
            options
        )

        if (result.result === 'version-mismatch') {
            const refreshed = this.getSession(session.id) ?? this.sessionCache.refreshSession(session.id) ?? session
            if (JSON.stringify(refreshed.metadata) === JSON.stringify(metadata)) {
                return refreshed
            }

            const retry = this.store.sessions.updateSessionMetadata(
                session.id,
                metadata,
                refreshed.metadataVersion,
                refreshed.namespace,
                options
            )

            if (retry.result === 'success') {
                const next = this.sessionCache.refreshSession(session.id) ?? refreshed
                this.store.sessions.syncNativeAliasesForSessionMetadata(next.id, next.namespace, metadata)
                return next
            }

            return this.getSession(session.id) ?? this.sessionCache.refreshSession(session.id) ?? refreshed
        }

        if (result.result === 'success') {
            const next = this.sessionCache.refreshSession(session.id) ?? session
            this.store.sessions.syncNativeAliasesForSessionMetadata(next.id, next.namespace, metadata)
            return next
        }

        return this.getSession(session.id) ?? this.sessionCache.refreshSession(session.id) ?? session
    }

    private updateSessionAgentStateIfNeeded(session: Session, agentState: unknown): Session {
        if (JSON.stringify(session.agentState ?? null) === JSON.stringify(agentState ?? null)) {
            return session
        }

        const result = this.store.sessions.updateSessionAgentState(
            session.id,
            agentState ?? null,
            session.agentStateVersion,
            session.namespace
        )

        if (result.result === 'version-mismatch') {
            const refreshed = this.getSession(session.id) ?? this.sessionCache.refreshSession(session.id) ?? session
            if (JSON.stringify(refreshed.agentState ?? null) === JSON.stringify(agentState ?? null)) {
                return refreshed
            }

            const retry = this.store.sessions.updateSessionAgentState(
                session.id,
                agentState ?? null,
                refreshed.agentStateVersion,
                refreshed.namespace
            )

            if (retry.result === 'success') {
                return this.sessionCache.refreshSession(session.id) ?? refreshed
            }

            return this.getSession(session.id) ?? this.sessionCache.refreshSession(session.id) ?? refreshed
        }

        if (result.result === 'success') {
            return this.sessionCache.refreshSession(session.id) ?? session
        }

        return this.getSession(session.id) ?? this.sessionCache.refreshSession(session.id) ?? session
    }

    private reconcileSessionTimestamps(session: Session, createdAt: number, lastActivityAt: number): Session {
        const reconciled = this.store.sessions.reconcileSessionTimestamps(
            session.id,
            session.namespace,
            { createdAt, lastActivityAt }
        )
        if (!reconciled) {
            return this.getSession(session.id) ?? this.sessionCache.refreshSession(session.id) ?? session
        }

        if (
            reconciled.createdAt === session.createdAt
            && reconciled.updatedAt === session.updatedAt
            && reconciled.seq === session.seq
        ) {
            return this.getSession(session.id) ?? session
        }

        return this.sessionCache.refreshSession(session.id) ?? this.getSession(session.id) ?? session
    }

    private resolveNativeSessionIdentity(metadata: unknown): { provider: 'claude' | 'codex'; nativeSessionId: string } | null {
        if (!isObject(metadata)) {
            return null
        }

        const provider = metadata.nativeProvider
        const nativeSessionId = metadata.nativeSessionId
        if (
            (provider === 'claude' || provider === 'codex')
            && typeof nativeSessionId === 'string'
            && nativeSessionId.length > 0
        ) {
            return { provider, nativeSessionId }
        }

        return null
    }

    private resolveSessionByNativeAlias(
        namespace: string,
        provider: 'claude' | 'codex',
        nativeSessionId: string
    ): Session | null {
        const stored = this.store.sessions.getSessionByNativeAlias(namespace, provider, nativeSessionId)
        if (!stored) {
            return null
        }

        return this.getSession(stored.id) ?? this.sessionCache.refreshSession(stored.id)
    }

    private sessionMatchesNativeIdentity(
        session: Session,
        identity: { provider: 'claude' | 'codex'; nativeSessionId: string }
    ): boolean {
        const metadata = session.metadata
        if (!metadata) {
            return false
        }

        if (
            metadata.nativeSessionId === identity.nativeSessionId
            && (metadata.nativeProvider === undefined || metadata.nativeProvider === identity.provider)
        ) {
            return true
        }

        if (identity.provider === 'claude') {
            return metadata.claudeSessionId === identity.nativeSessionId
        }

        return metadata.codexSessionId === identity.nativeSessionId
    }

    private pickCanonicalNativeSession(sessions: Session[]): Session | null {
        if (sessions.length === 0) {
            return null
        }

        const sourceRank = (session: Session): number => {
            const source = session.metadata?.source
            if (source === 'hybrid') return 0
            if (source === 'native') return 2
            return 1
        }

        const sorted = [...sessions].sort((left, right) => {
            const leftSourceRank = sourceRank(left)
            const rightSourceRank = sourceRank(right)
            if (leftSourceRank !== rightSourceRank) {
                return leftSourceRank - rightSourceRank
            }
            if (left.active !== right.active) {
                return left.active ? -1 : 1
            }
            if (left.updatedAt !== right.updatedAt) {
                return right.updatedAt - left.updatedAt
            }
            return right.createdAt - left.createdAt
        })

        return sorted[0] ?? null
    }

    private mergeIncomingNativeMetadata(session: Session, incomingMetadata: unknown): unknown {
        if (
            session.metadata
            && session.metadata.source !== 'native'
            && session.metadata.source !== 'hybrid'
            && isObject(incomingMetadata)
        ) {
            return this.buildHybridSessionMetadata(
                incomingMetadata as Session['metadata'],
                session.metadata
            )
        }

        return this.mergeNativeSessionMetadata(session.metadata, incomingMetadata)
    }

    private dropSessionIfPresent(sessionId: string, namespace: string): void {
        const deleted = this.store.sessions.deleteSession(sessionId, namespace)
        if (!deleted) {
            return
        }

        this.sessionCache.refreshSession(sessionId)
    }

    private mergeNativeSessionMetadata(
        existingMetadata: Session['metadata'],
        incomingMetadata: unknown
    ): unknown {
        if (!isObject(incomingMetadata) || !isObject(existingMetadata)) {
            return incomingMetadata
        }

        const existingSource = existingMetadata.source
        const incomingSource = incomingMetadata.source
        if (
            existingSource !== 'native'
            && existingSource !== 'hybrid'
            && incomingSource !== 'native'
            && incomingSource !== 'hybrid'
        ) {
            return incomingMetadata
        }

        const merged: Record<string, unknown> = { ...existingMetadata }
        const nativeManagedKeys = [
            'path',
            'host',
            'name',
            'machineId',
            'flavor',
            'source',
            'nativeProvider',
            'nativeSessionId',
            'nativeProjectPath',
            'nativeDiscoveredAt',
            'nativeLastSyncedAt',
            'claudeSessionId',
            'codexSessionId'
        ] as const

        for (const key of nativeManagedKeys) {
            if (incomingMetadata[key] !== undefined) {
                merged[key] = incomingMetadata[key]
            }
        }

        if (existingSource === 'hybrid') {
            merged.source = 'hybrid'
        }

        return merged
    }

    private mergeNativeSessionAgentState(
        existingAgentState: Session['agentState'],
        incomingAgentState: unknown | null | undefined
    ): unknown | null {
        if (incomingAgentState === null || incomingAgentState === undefined) {
            return existingAgentState ?? null
        }

        return incomingAgentState
    }

    private buildHybridSessionMetadata(
        canonicalMetadata: Session['metadata'],
        resumedMetadata: Session['metadata']
    ): Session['metadata'] {
        if (!canonicalMetadata && !resumedMetadata) {
            return null
        }

        const canonical = canonicalMetadata ?? { path: '', host: '' }
        const resumed = resumedMetadata ?? { path: canonical.path, host: canonical.host }

        return {
            ...canonical,
            ...resumed,
            source: 'hybrid',
            nativeProvider: canonical.nativeProvider ?? resumed.nativeProvider,
            nativeSessionId: canonical.nativeSessionId ?? resumed.nativeSessionId,
            nativeProjectPath: canonical.nativeProjectPath ?? resumed.nativeProjectPath,
            nativeDiscoveredAt: canonical.nativeDiscoveredAt ?? resumed.nativeDiscoveredAt,
            nativeLastSyncedAt: canonical.nativeLastSyncedAt ?? resumed.nativeLastSyncedAt,
            claudeSessionId: canonical.claudeSessionId ?? resumed.claudeSessionId,
            codexSessionId: canonical.codexSessionId ?? resumed.codexSessionId
        }
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>
    ): Promise<void> {
        await this.rpcGateway.approvePermission(sessionId, requestId, mode, allowTools, decision, answers)
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.rpcGateway.denyPermission(sessionId, requestId, decision)
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.rpcGateway.abortSession(sessionId)
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.rpcGateway.killSession(sessionId)
        this.handleSessionEnd({ sid: sessionId, time: Date.now() })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.rpcGateway.switchSession(sessionId, to)
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.sessionCache.renameSession(sessionId, name)
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.sessionCache.deleteSession(sessionId)
    }

    async applySessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            modelMode?: ModelMode
        }
    ): Promise<void> {
        const result = await this.rpcGateway.requestSessionConfig(sessionId, config)
        if (!result || typeof result !== 'object') {
            throw new Error('Invalid response from session config RPC')
        }
        const obj = result as { applied?: { permissionMode?: Session['permissionMode']; modelMode?: Session['modelMode'] } }
        const applied = obj.applied
        if (!applied || typeof applied !== 'object') {
            throw new Error('Missing applied session config')
        }

        this.sessionCache.applySessionConfig(sessionId, applied)
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode' = 'claude',
        model?: string,
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        sessionId?: string
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        return await this.rpcGateway.spawnSession(machineId, directory, agent, model, yolo, sessionType, worktreeName, resumeSessionId, sessionId)
    }

    async resumeSession(sessionId: string, namespace: string): Promise<ResumeSessionResult> {
        const access = this.sessionCache.resolveSessionAccess(sessionId, namespace)
        if (!access.ok) {
            return {
                type: 'error',
                message: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found',
                code: access.reason === 'access-denied' ? 'access_denied' : 'session_not_found'
            }
        }

        const session = access.session
        if (session.active) {
            return { type: 'success', sessionId: access.sessionId }
        }

        const metadata = session.metadata
        if (!metadata || typeof metadata.path !== 'string') {
            return { type: 'error', message: 'Session metadata missing path', code: 'resume_unavailable' }
        }

        const flavor = metadata.flavor === 'codex' || metadata.flavor === 'gemini' || metadata.flavor === 'opencode' || metadata.flavor === 'cursor'
            ? metadata.flavor
            : 'claude'
        const resumeToken = flavor === 'codex'
            ? metadata.codexSessionId
            : flavor === 'gemini'
                ? metadata.geminiSessionId
                : flavor === 'opencode'
                    ? metadata.opencodeSessionId
                    : flavor === 'cursor'
                        ? metadata.cursorSessionId
                        : metadata.claudeSessionId

        if (!resumeToken) {
            return { type: 'error', message: 'Resume session ID unavailable', code: 'resume_unavailable' }
        }

        const onlineMachines = this.machineCache.getOnlineMachinesByNamespace(namespace)
        if (onlineMachines.length === 0) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const targetMachine = (() => {
            if (metadata.machineId) {
                const exact = onlineMachines.find((machine) => machine.id === metadata.machineId)
                if (exact) return exact
            }
            if (metadata.host) {
                const hostMatch = onlineMachines.find((machine) => machine.metadata?.host === metadata.host)
                if (hostMatch) return hostMatch
            }
            return null
        })()

        if (!targetMachine) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const spawnResult = await this.rpcGateway.spawnSession(
            targetMachine.id,
            metadata.path,
            flavor,
            undefined,
            undefined,
            undefined,
            undefined,
            resumeToken,
            access.sessionId
        )

        if (spawnResult.type !== 'success') {
            return { type: 'error', message: spawnResult.message, code: 'resume_failed' }
        }

        const becameActive = await this.waitForSessionActive(spawnResult.sessionId)
        if (!becameActive) {
            return { type: 'error', message: 'Session failed to become active', code: 'resume_failed' }
        }

        const resumedSession = this.getSession(spawnResult.sessionId)
        const hybridMetadata = this.buildHybridSessionMetadata(access.session.metadata, resumedSession?.metadata ?? null)

        if (spawnResult.sessionId !== access.sessionId) {
            try {
                this.store.rawEvents.rehomeSession(spawnResult.sessionId, access.sessionId)
                await this.sessionCache.mergeSessions(
                    spawnResult.sessionId,
                    access.sessionId,
                    namespace,
                    {
                        mergedMetadata: hybridMetadata,
                        mergedAgentState: resumedSession?.agentState ?? access.session.agentState ?? null
                    }
                )
                await this.messageService.rebuildSessionCanonicalState(access.sessionId)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to merge resumed session'
                return { type: 'error', message, code: 'resume_failed' }
            }

            return { type: 'success', sessionId: access.sessionId }
        }

        const currentSession = this.getSession(access.sessionId) ?? access.session
        this.updateSessionMetadataIfNeeded(currentSession, hybridMetadata)
        this.sessionCache.refreshSession(access.sessionId)

        return { type: 'success', sessionId: access.session.id }
    }

    async waitForSessionActive(sessionId: string, timeoutMs: number = 15_000): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const session = this.getSession(sessionId)
            if (session?.active) {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
        }
        return false
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        return await this.rpcGateway.checkPathsExist(machineId, paths)
    }

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitStatus(sessionId, cwd)
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitDiffNumstat(sessionId, options)
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitDiffFile(sessionId, options)
    }

    async readSessionFile(sessionId: string, path: string): Promise<RpcReadFileResponse> {
        return await this.rpcGateway.readSessionFile(sessionId, path)
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.listDirectory(sessionId, path)
    }

    async listMachineDirectory(machineId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.listMachineDirectory(machineId, path)
    }

    async createMachineDirectory(machineId: string, parentPath: string, name: string): Promise<RpcCreateMachineDirectoryResponse> {
        return await this.rpcGateway.createMachineDirectory(machineId, parentPath, name)
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.rpcGateway.uploadFile(sessionId, filename, content, mimeType)
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.rpcGateway.deleteUploadFile(sessionId, path)
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.rpcGateway.runRipgrep(sessionId, args, cwd)
    }

    async listSlashCommands(sessionId: string, agent: string): Promise<{
        success: boolean
        commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
        error?: string
    }> {
        return await this.rpcGateway.listSlashCommands(sessionId, agent)
    }

    async listSkills(sessionId: string): Promise<{
        success: boolean
        skills?: Array<{ name: string; description?: string }>
        error?: string
    }> {
        return await this.rpcGateway.listSkills(sessionId)
    }
}
