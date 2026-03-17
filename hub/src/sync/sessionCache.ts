import { AgentStateSchema, MetadataSchema, TeamStateSchema } from '@hapi/protocol/schemas'
import type { ModelMode, PermissionMode, Session } from '@hapi/protocol/types'
import type { Store } from '../store'
import { clampAliveTime } from './aliveTime'
import { EventPublisher } from './eventPublisher'
import { TodosSchema } from './todos'

export class SessionCache {
    private readonly sessions: Map<string, Session> = new Map()
    private readonly lastBroadcastAtBySessionId: Map<string, number> = new Map()

    constructor(
        private readonly store: Store,
        private readonly publisher: EventPublisher
    ) {
    }

    getSessions(): Session[] {
        return Array.from(this.sessions.values())
    }

    getSessionsByNamespace(namespace: string): Session[] {
        return this.getSessions().filter((session) => session.namespace === namespace)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId)
    }

    getSessionByNamespace(sessionId: string, namespace: string): Session | undefined {
        const session = this.sessions.get(sessionId)
        if (!session || session.namespace !== namespace) {
            return undefined
        }
        return session
    }

    resolveSessionAccess(
        sessionId: string,
        namespace: string
    ): { ok: true; sessionId: string; session: Session } | { ok: false; reason: 'not-found' | 'access-denied' } {
        const session = this.sessions.get(sessionId) ?? this.refreshSession(sessionId)
        if (session) {
            if (session.namespace !== namespace) {
                return { ok: false, reason: 'access-denied' }
            }
            return { ok: true, sessionId, session }
        }

        return { ok: false, reason: 'not-found' }
    }

    getActiveSessions(): Session[] {
        return this.getSessions().filter((session) => session.active)
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string): Session {
        const stored = this.store.sessions.getOrCreateSession(tag, metadata, agentState, namespace)
        return this.refreshSession(stored.id) ?? (() => { throw new Error('Failed to load session') })()
    }

    refreshSession(sessionId: string): Session | null {
        let stored = this.store.sessions.getSession(sessionId)
        if (!stored) {
            const existed = this.sessions.delete(sessionId)
            if (existed) {
                this.publisher.emit({ type: 'session-removed', sessionId })
            }
            return null
        }

        const existing = this.sessions.get(sessionId)

        const metadata = (() => {
            const parsed = MetadataSchema.safeParse(stored.metadata)
            return parsed.success ? parsed.data : null
        })()

        const agentState = (() => {
            const parsed = AgentStateSchema.safeParse(stored.agentState)
            return parsed.success ? parsed.data : null
        })()

        const todos = (() => {
            if (stored.todos === null) return undefined
            const parsed = TodosSchema.safeParse(stored.todos)
            return parsed.success ? parsed.data : undefined
        })()

        const teamState = (() => {
            if (stored.teamState === null || stored.teamState === undefined) return undefined
            const parsed = TeamStateSchema.safeParse(stored.teamState)
            return parsed.success ? parsed.data : undefined
        })()

        const session: Session = {
            id: stored.id,
            namespace: stored.namespace,
            seq: stored.seq,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            active: existing?.active ?? stored.active,
            activeAt: existing?.activeAt ?? (stored.activeAt ?? stored.createdAt),
            metadata,
            metadataVersion: stored.metadataVersion,
            agentState,
            agentStateVersion: stored.agentStateVersion,
            thinking: existing?.thinking ?? false,
            thinkingAt: existing?.thinkingAt ?? 0,
            todos,
            teamState,
            permissionMode: existing?.permissionMode,
            modelMode: existing?.modelMode
        }

        this.sessions.set(sessionId, session)
        this.publisher.emit({ type: existing ? 'session-updated' : 'session-added', sessionId, data: session })
        return session
    }

    reloadAll(): void {
        const sessions = this.store.sessions.getSessions()
        for (const session of sessions) {
            this.refreshSession(session.id)
        }
    }

    handleSessionAlive(payload: {
        sid: string
        time: number
        thinking?: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        modelMode?: ModelMode
    }): void {
        const t = clampAliveTime(payload.time)
        if (!t) return

        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return

        const wasActive = session.active
        const wasThinking = session.thinking
        const previousPermissionMode = session.permissionMode
        const previousModelMode = session.modelMode

        session.active = true
        session.activeAt = Math.max(session.activeAt, t)
        session.thinking = Boolean(payload.thinking)
        session.thinkingAt = t
        if (payload.permissionMode !== undefined) {
            session.permissionMode = payload.permissionMode
        }
        if (payload.modelMode !== undefined) {
            session.modelMode = payload.modelMode
        }

        const now = Date.now()
        const lastBroadcastAt = this.lastBroadcastAtBySessionId.get(session.id) ?? 0
        const modeChanged = previousPermissionMode !== session.permissionMode || previousModelMode !== session.modelMode
        const shouldBroadcast = (!wasActive && session.active)
            || (wasThinking !== session.thinking)
            || modeChanged
            || (now - lastBroadcastAt > 10_000)

        if (shouldBroadcast) {
            this.lastBroadcastAtBySessionId.set(session.id, now)
            this.publisher.emit({
                type: 'session-updated',
                sessionId: session.id,
                data: {
                    active: true,
                    activeAt: session.activeAt,
                    thinking: session.thinking,
                    permissionMode: session.permissionMode,
                    modelMode: session.modelMode
                }
            })
        }
    }

    handleSessionEnd(payload: { sid: string; time: number }): void {
        const t = clampAliveTime(payload.time) ?? Date.now()

        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return

        if (!session.active && !session.thinking) {
            return
        }

        session.active = false
        session.thinking = false
        session.thinkingAt = t

        this.publisher.emit({ type: 'session-updated', sessionId: session.id, data: { active: false, thinking: false } })
    }

    expireInactive(now: number = Date.now()): void {
        const sessionTimeoutMs = 30_000

        for (const session of this.sessions.values()) {
            if (!session.active) continue
            if (now - session.activeAt <= sessionTimeoutMs) continue
            session.active = false
            session.thinking = false
            this.publisher.emit({ type: 'session-updated', sessionId: session.id, data: { active: false } })
        }
    }

    applySessionConfig(sessionId: string, config: { permissionMode?: PermissionMode; modelMode?: ModelMode }): void {
        const session = this.sessions.get(sessionId) ?? this.refreshSession(sessionId)
        if (!session) {
            return
        }

        if (config.permissionMode !== undefined) {
            session.permissionMode = config.permissionMode
        }
        if (config.modelMode !== undefined) {
            session.modelMode = config.modelMode
        }

        this.publisher.emit({ type: 'session-updated', sessionId, data: session })
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session) {
            throw new Error('Session not found')
        }

        const currentMetadata = session.metadata ?? { path: '', host: '' }
        const newMetadata = { ...currentMetadata, name }

        const result = this.store.sessions.updateSessionMetadata(
            sessionId,
            newMetadata,
            session.metadataVersion,
            session.namespace,
            { touchUpdatedAt: false }
        )

        if (result.result === 'error') {
            throw new Error('Failed to update session metadata')
        }

        if (result.result === 'version-mismatch') {
            throw new Error('Session was modified concurrently. Please try again.')
        }

        this.refreshSession(sessionId)
    }

    async deleteSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session) {
            throw new Error('Session not found')
        }

        if (session.active) {
            throw new Error('Cannot delete active session')
        }

        const deleted = this.store.sessions.deleteSession(sessionId, session.namespace)
        if (!deleted) {
            throw new Error('Failed to delete session')
        }

        this.sessions.delete(sessionId)
        this.lastBroadcastAtBySessionId.delete(sessionId)

        this.publisher.emit({ type: 'session-removed', sessionId, namespace: session.namespace })
    }

    async mergeSessions(
        sourceSessionId: string,
        targetSessionId: string,
        namespace: string,
        options?: {
            mergedMetadata?: unknown | null
            mergedAgentState?: unknown | null
        }
    ): Promise<void> {
        if (sourceSessionId === targetSessionId) {
            return
        }

        const sourceStored = this.store.sessions.getSessionByNamespace(sourceSessionId, namespace)
        const targetStored = this.store.sessions.getSessionByNamespace(targetSessionId, namespace)
        if (!sourceStored || !targetStored) {
            throw new Error('Session not found for merge')
        }

        const sourceSession = this.sessions.get(sourceSessionId) ?? this.refreshSession(sourceSessionId) ?? undefined
        const targetSession = this.sessions.get(targetSessionId) ?? this.refreshSession(targetSessionId) ?? undefined

        this.store.sessions.reconcileSessionTimestamps(targetSessionId, namespace, {
            createdAt: Math.min(sourceStored.createdAt, targetStored.createdAt),
            lastActivityAt: Math.max(sourceStored.updatedAt, targetStored.updatedAt)
        })

        const mergedMetadata = options?.mergedMetadata !== undefined
            ? options.mergedMetadata
            : this.mergeSessionMetadata(sourceStored.metadata, targetStored.metadata)
        if (mergedMetadata !== null && mergedMetadata !== targetStored.metadata) {
            for (let attempt = 0; attempt < 2; attempt += 1) {
                const latest = this.store.sessions.getSessionByNamespace(targetSessionId, namespace)
                if (!latest) break
                const result = this.store.sessions.updateSessionMetadata(
                    targetSessionId,
                    mergedMetadata,
                    latest.metadataVersion,
                    namespace,
                    { touchUpdatedAt: false }
                )
                if (result.result === 'success') {
                    break
                }
                if (result.result === 'error') {
                    break
                }
            }
        }

        const mergedAgentState = options?.mergedAgentState !== undefined
            ? options.mergedAgentState
            : (sourceStored.agentState ?? targetStored.agentState)
        if (mergedAgentState !== undefined && mergedAgentState !== targetStored.agentState) {
            for (let attempt = 0; attempt < 2; attempt += 1) {
                const latest = this.store.sessions.getSessionByNamespace(targetSessionId, namespace)
                if (!latest) break
                const result = this.store.sessions.updateSessionAgentState(
                    targetSessionId,
                    mergedAgentState,
                    latest.agentStateVersion,
                    namespace
                )
                if (result.result === 'success' || result.result === 'error') {
                    break
                }
            }
        }

        if (
            sourceStored.todos !== null
            && sourceStored.todosUpdatedAt !== null
            && (targetStored.todosUpdatedAt === null || sourceStored.todosUpdatedAt > targetStored.todosUpdatedAt)
        ) {
            this.store.sessions.setSessionTodos(
                targetSessionId,
                sourceStored.todos,
                sourceStored.todosUpdatedAt,
                namespace
            )
        }

        if (
            sourceStored.teamState !== null
            && sourceStored.teamStateUpdatedAt !== null
            && (targetStored.teamStateUpdatedAt === null || sourceStored.teamStateUpdatedAt > targetStored.teamStateUpdatedAt)
        ) {
            this.store.sessions.setSessionTeamState(
                targetSessionId,
                sourceStored.teamState,
                sourceStored.teamStateUpdatedAt,
                namespace
            )
        }

        const deleted = this.store.sessions.deleteSession(sourceSessionId, namespace)
        if (!deleted) {
            throw new Error('Failed to delete source session during merge')
        }

        const existed = this.sessions.delete(sourceSessionId)
        if (existed) {
            this.publisher.emit({ type: 'session-removed', sessionId: sourceSessionId, namespace })
        }
        this.lastBroadcastAtBySessionId.delete(sourceSessionId)

        const refreshed = this.refreshSession(targetSessionId)
        if (!refreshed) {
            return
        }

        const runtimeSource = sourceSession
        const runtimeTarget = targetSession
        if (runtimeSource || runtimeTarget) {
            refreshed.active = Boolean(runtimeSource?.active || runtimeTarget?.active || refreshed.active)
            refreshed.activeAt = Math.max(
                refreshed.activeAt,
                runtimeSource?.activeAt ?? 0,
                runtimeTarget?.activeAt ?? 0
            )
            refreshed.thinking = Boolean(runtimeSource?.thinking || runtimeTarget?.thinking || refreshed.thinking)
            refreshed.thinkingAt = Math.max(
                refreshed.thinkingAt,
                runtimeSource?.thinkingAt ?? 0,
                runtimeTarget?.thinkingAt ?? 0
            )
            if (runtimeSource?.permissionMode !== undefined) {
                refreshed.permissionMode = runtimeSource.permissionMode
            } else if (runtimeTarget?.permissionMode !== undefined) {
                refreshed.permissionMode = runtimeTarget.permissionMode
            }
            if (runtimeSource?.modelMode !== undefined) {
                refreshed.modelMode = runtimeSource.modelMode
            } else if (runtimeTarget?.modelMode !== undefined) {
                refreshed.modelMode = runtimeTarget.modelMode
            }

            this.publisher.emit({ type: 'session-updated', sessionId: targetSessionId, data: refreshed })
        }
    }

    private mergeSessionMetadata(oldMetadata: unknown | null, newMetadata: unknown | null): unknown | null {
        if (!oldMetadata || typeof oldMetadata !== 'object') {
            return newMetadata
        }
        if (!newMetadata || typeof newMetadata !== 'object') {
            return oldMetadata
        }

        const oldObj = oldMetadata as Record<string, unknown>
        const newObj = newMetadata as Record<string, unknown>
        const merged: Record<string, unknown> = { ...newObj }
        let changed = false

        if (typeof oldObj.name === 'string' && typeof newObj.name !== 'string') {
            merged.name = oldObj.name
            changed = true
        }

        const oldSummary = oldObj.summary as { text?: unknown; updatedAt?: unknown } | undefined
        const newSummary = newObj.summary as { text?: unknown; updatedAt?: unknown } | undefined
        const oldUpdatedAt = typeof oldSummary?.updatedAt === 'number' ? oldSummary.updatedAt : null
        const newUpdatedAt = typeof newSummary?.updatedAt === 'number' ? newSummary.updatedAt : null
        if (oldUpdatedAt !== null && (newUpdatedAt === null || oldUpdatedAt > newUpdatedAt)) {
            merged.summary = oldSummary
            changed = true
        }

        if (oldObj.worktree && !newObj.worktree) {
            merged.worktree = oldObj.worktree
            changed = true
        }

        if (typeof oldObj.path === 'string' && typeof newObj.path !== 'string') {
            merged.path = oldObj.path
            changed = true
        }
        if (typeof oldObj.host === 'string' && typeof newObj.host !== 'string') {
            merged.host = oldObj.host
            changed = true
        }

        return changed ? merged : newMetadata
    }
}
