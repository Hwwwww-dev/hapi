import { AgentStateSchema, MetadataSchema, TeamStateSchema } from '@hapi/protocol/schemas'
import type { CodexCollaborationMode, PermissionMode, Session } from '@hapi/protocol/types'
import type { Store } from '../store'
import { clampAliveTime } from './aliveTime'
import { EventPublisher } from './eventPublisher'
import { extractTodoWriteTodosFromMessageContent, TodosSchema } from './todos'
import { extractBackgroundTaskDelta } from './backgroundTasks'

export class SessionCache {
    private readonly sessions: Map<string, Session> = new Map()
    private readonly lastBroadcastAtBySessionId: Map<string, number> = new Map()
    private readonly todoBackfillAttemptedSessionIds: Set<string> = new Set()
    private readonly deduplicateInProgress: Set<string> = new Set()

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

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string, model?: string, effort?: string, modelReasoningEffort?: string, overrideId?: string): Session | null {
        const stored = this.store.sessions.getOrCreateSession(tag, metadata, agentState, namespace, model, effort, modelReasoningEffort, overrideId)
        if (!stored) return null
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

        if (stored.todos === null && !this.todoBackfillAttemptedSessionIds.has(sessionId)) {
            this.todoBackfillAttemptedSessionIds.add(sessionId)
            const messages = this.store.messages.getMessages(sessionId, 200)
            for (let i = messages.length - 1; i >= 0; i -= 1) {
                const message = messages[i]
                const todos = extractTodoWriteTodosFromMessageContent(message.content)
                if (todos) {
                    const updated = this.store.sessions.setSessionTodos(sessionId, todos, message.createdAt, stored.namespace)
                    if (updated) {
                        stored = this.store.sessions.getSession(sessionId) ?? stored
                    }
                    break
                }
            }
        }

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
            backgroundTaskCount: existing?.backgroundTaskCount ?? 0,
            todos,
            teamState,
            model: stored.model,
            modelReasoningEffort: stored.modelReasoningEffort,
            effort: stored.effort,
            permissionMode: existing?.permissionMode,
            collaborationMode: existing?.collaborationMode
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
        model?: string | null
        modelReasoningEffort?: string | null
        effort?: string | null
        collaborationMode?: CodexCollaborationMode
    }): void {
        const t = clampAliveTime(payload.time)
        if (!t) return

        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return

        const wasActive = session.active
        const wasThinking = session.thinking
        const previousPermissionMode = session.permissionMode
        const previousModel = session.model
        const previousModelReasoningEffort = session.modelReasoningEffort
        const previousEffort = session.effort
        const previousCollaborationMode = session.collaborationMode

        session.active = true
        session.activeAt = Math.max(session.activeAt, t)
        session.thinking = Boolean(payload.thinking)
        session.thinkingAt = t
        if (payload.permissionMode !== undefined) {
            session.permissionMode = payload.permissionMode
        }
        if (payload.model !== undefined) {
            if (payload.model !== session.model) {
                this.store.sessions.setSessionModel(payload.sid, payload.model, session.namespace, {
                    touchUpdatedAt: false
                })
            }
            session.model = payload.model
        }
        if (payload.modelReasoningEffort !== undefined) {
            if (payload.modelReasoningEffort !== session.modelReasoningEffort) {
                this.store.sessions.setSessionModelReasoningEffort(payload.sid, payload.modelReasoningEffort, session.namespace, {
                    touchUpdatedAt: false
                })
            }
            session.modelReasoningEffort = payload.modelReasoningEffort
        }
        if (payload.effort !== undefined) {
            if (payload.effort !== session.effort) {
                this.store.sessions.setSessionEffort(payload.sid, payload.effort, session.namespace, {
                    touchUpdatedAt: false
                })
            }
            session.effort = payload.effort
        }
        if (payload.collaborationMode !== undefined) {
            session.collaborationMode = payload.collaborationMode
        }

        const now = Date.now()
        const lastBroadcastAt = this.lastBroadcastAtBySessionId.get(session.id) ?? 0
        const modeChanged = previousPermissionMode !== session.permissionMode
            || previousModel !== session.model
            || previousModelReasoningEffort !== session.modelReasoningEffort
            || previousEffort !== session.effort
            || previousCollaborationMode !== session.collaborationMode
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
                    model: session.model,
                    modelReasoningEffort: session.modelReasoningEffort,
                    effort: session.effort,
                    collaborationMode: session.collaborationMode
                }
            })
        }
    }

    applyBackgroundTaskDelta(sessionId: string, delta: { started: number; completed: number }): void {
        const session = this.sessions.get(sessionId)
        if (!session) return

        const prev = session.backgroundTaskCount ?? 0
        const next = Math.max(0, prev + delta.started - delta.completed)
        if (next === prev) return

        session.backgroundTaskCount = next
        this.publisher.emit({
            type: 'session-updated',
            sessionId,
            data: { backgroundTaskCount: next }
        })
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
        session.backgroundTaskCount = 0

        this.publisher.emit({ type: 'session-updated', sessionId: session.id, data: { active: false, thinking: false, backgroundTaskCount: 0 } })
    }

    expireInactive(now: number = Date.now()): string[] {
        const sessionTimeoutMs = 30_000
        const expired: string[] = []

        for (const session of this.sessions.values()) {
            if (!session.active) continue
            if (now - session.activeAt <= sessionTimeoutMs) continue
            session.active = false
            session.thinking = false
            expired.push(session.id)
            this.publisher.emit({ type: 'session-updated', sessionId: session.id, data: { active: false } })
        }

        return expired
    }

    applySessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            model?: string | null
            modelReasoningEffort?: string | null
            effort?: string | null
            collaborationMode?: CodexCollaborationMode
        }
    ): void {
        const session = this.sessions.get(sessionId) ?? this.refreshSession(sessionId)
        if (!session) {
            return
        }

        if (config.permissionMode !== undefined) {
            session.permissionMode = config.permissionMode
        }
        if (config.model !== undefined) {
            if (config.model !== session.model) {
                const updated = this.store.sessions.setSessionModel(sessionId, config.model, session.namespace, {
                    touchUpdatedAt: false
                })
                if (!updated) {
                    throw new Error('Failed to update session model')
                }
            }
            session.model = config.model
        }
        if (config.modelReasoningEffort !== undefined) {
            if (config.modelReasoningEffort !== session.modelReasoningEffort) {
                const updated = this.store.sessions.setSessionModelReasoningEffort(sessionId, config.modelReasoningEffort, session.namespace, {
                    touchUpdatedAt: false
                })
                if (!updated) {
                    throw new Error('Failed to update session model reasoning effort')
                }
            }
            session.modelReasoningEffort = config.modelReasoningEffort
        }
        if (config.effort !== undefined) {
            if (config.effort !== session.effort) {
                const updated = this.store.sessions.setSessionEffort(sessionId, config.effort, session.namespace, {
                    touchUpdatedAt: false
                })
                if (!updated) {
                    throw new Error('Failed to update session effort')
                }
            }
            session.effort = config.effort
        }
        if (config.collaborationMode !== undefined) {
            session.collaborationMode = config.collaborationMode
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
            // Already deleted or not found — treat as success (idempotent)
            return
        }

        if (session.active) {
            throw new Error('Cannot delete active session')
        }

        const deleted = this.store.sessions.deleteSession(sessionId, session.namespace)
        if (!deleted) {
            // May have already been soft-deleted — still clean up memory
        }

        this.sessions.delete(sessionId)
        this.lastBroadcastAtBySessionId.delete(sessionId)
        this.todoBackfillAttemptedSessionIds.delete(sessionId)

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

        this.store.messages.mergeSessionMessages(sourceSessionId, targetSessionId, {
            strategy: 'append-source'
        })
        this.store.sessions.reconcileSessionTimestamps(targetSessionId, namespace, {
            createdAt: targetStored.createdAt,
            lastActivityAt: targetStored.updatedAt
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

        if (targetStored.model === null && sourceStored.model !== null) {
            const updated = this.store.sessions.setSessionModel(targetSessionId, sourceStored.model, namespace, {
                touchUpdatedAt: false
            })
            if (!updated) {
                throw new Error('Failed to preserve session model during merge')
            }
        }

        if (targetStored.modelReasoningEffort === null && sourceStored.modelReasoningEffort !== null) {
            const updated = this.store.sessions.setSessionModelReasoningEffort(targetSessionId, sourceStored.modelReasoningEffort, namespace, {
                touchUpdatedAt: false
            })
            if (!updated) {
                throw new Error('Failed to preserve session model reasoning effort during merge')
            }
        }

        if (targetStored.effort === null && sourceStored.effort !== null) {
            const updated = this.store.sessions.setSessionEffort(targetSessionId, sourceStored.effort, namespace, {
                touchUpdatedAt: false
            })
            if (!updated) {
                throw new Error('Failed to preserve session effort during merge')
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
        this.todoBackfillAttemptedSessionIds.delete(sourceSessionId)

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

    private mergeAgentState(oldState: unknown | null, newState: unknown | null): unknown | null {
        if (oldState === null) return newState
        if (newState === null) return oldState

        const oldObj = oldState as Record<string, unknown>
        const newObj = newState as Record<string, unknown>

        const completedRequests = {
            ...((oldObj.completedRequests as Record<string, unknown> | undefined) ?? {}),
            ...((newObj.completedRequests as Record<string, unknown> | undefined) ?? {})
        }
        // Filter out requests that are already completed to avoid resurrecting them as pending
        const completedIds = new Set(Object.keys(completedRequests))
        const requests = Object.fromEntries(
            Object.entries({
                ...((oldObj.requests as Record<string, unknown> | undefined) ?? {}),
                ...((newObj.requests as Record<string, unknown> | undefined) ?? {})
            }).filter(([id]) => !completedIds.has(id))
        )

        return { ...oldObj, ...newObj, requests, completedRequests }
    }

    private extractAgentSessionId(
        metadata: NonNullable<Session['metadata']>
    ): { field: 'codexSessionId' | 'claudeSessionId' | 'geminiSessionId' | 'opencodeSessionId' | 'cursorSessionId'; value: string } | null {
        if (metadata.codexSessionId) return { field: 'codexSessionId', value: metadata.codexSessionId }
        if (metadata.claudeSessionId) return { field: 'claudeSessionId', value: metadata.claudeSessionId }
        if (metadata.geminiSessionId) return { field: 'geminiSessionId', value: metadata.geminiSessionId }
        if (metadata.opencodeSessionId) return { field: 'opencodeSessionId', value: metadata.opencodeSessionId }
        if (metadata.cursorSessionId) return { field: 'cursorSessionId', value: metadata.cursorSessionId }
        return null
    }

    async deduplicateByAgentSessionId(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session?.metadata) return

        const agentId = this.extractAgentSessionId(session.metadata)
        if (!agentId) return

        // Guard: skip if another dedup for this agent ID is already in progress.
        // A skipped trigger is acceptable — the web-side display dedup hides any remaining duplicates.
        if (this.deduplicateInProgress.has(agentId.value)) return
        this.deduplicateInProgress.add(agentId.value)

        try {
            const candidates: { id: string; session: Session }[] = [{ id: sessionId, session }]
            for (const [existingId, existing] of this.sessions) {
                if (existingId === sessionId) continue
                if (existing.namespace !== session.namespace) continue
                if (!existing.metadata) continue
                if (existing.metadata[agentId.field] !== agentId.value) continue
                // Only merge inactive duplicates. Active ones still have a live CLI socket
                // whose keepalive/messages would fail if we deleted their session record.
                // The web-side display dedup hides active duplicates from the UI.
                if (existing.active) continue
                candidates.push({ id: existingId, session: existing })
            }

            if (candidates.length <= 1) return

            // Keep the most recent session as the merge target so newer state survives.
            candidates.sort((a, b) =>
                (b.session.activeAt - a.session.activeAt) || (b.session.updatedAt - a.session.updatedAt)
            )
            const targetId = candidates[0].id
            const targetNamespace = candidates[0].session.namespace

            for (const { id } of candidates.slice(1)) {
                if (id === targetId) continue
                try {
                    await this.mergeSessions(id, targetId, targetNamespace)
                } catch {
                    // best-effort: duplicate remains if merge fails
                }
            }
        } finally {
            this.deduplicateInProgress.delete(agentId.value)
        }
    }
}
