import type { Database } from 'bun:sqlite'

import type { StoredSession, VersionedUpdateResult } from './types'
import {
    deleteSession,
    getOrCreateSession,
    getSession,
    getSessionByNativeAlias,
    getSessionByNamespace,
    getSessions,
    getSessionsByNamespace,
    isSessionSoftDeleted,
    reconcileSessionTimestamps,
    setSessionEffort,
    setSessionModel,
    setSessionModelReasoningEffort,
    setSessionTeamState,
    setSessionTodos,
    syncNativeAliasesForSessionMetadata,
    updateSessionAgentState,
    updateSessionMetadata
} from './sessions'

export class SessionStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string, model?: string, effort?: string, modelReasoningEffort?: string, overrideId?: string): StoredSession | null {
        return getOrCreateSession(this.db, tag, metadata, agentState, namespace, model, effort, modelReasoningEffort, overrideId)
    }

    updateSessionMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string,
        options?: { touchUpdatedAt?: boolean }
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionMetadata(this.db, id, metadata, expectedVersion, namespace, options)
    }

    updateSessionAgentState(
        id: string,
        agentState: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionAgentState(this.db, id, agentState, expectedVersion, namespace)
    }

    setSessionTodos(id: string, todos: unknown, todosUpdatedAt: number, namespace: string): boolean {
        return setSessionTodos(this.db, id, todos, todosUpdatedAt, namespace)
    }

    setSessionTeamState(id: string, teamState: unknown, updatedAt: number, namespace: string): boolean {
        return setSessionTeamState(this.db, id, teamState, updatedAt, namespace)
    }

    setSessionModel(id: string, model: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): boolean {
        return setSessionModel(this.db, id, model, namespace, options)
    }

    setSessionModelReasoningEffort(
        id: string,
        modelReasoningEffort: string | null,
        namespace: string,
        options?: { touchUpdatedAt?: boolean }
    ): boolean {
        return setSessionModelReasoningEffort(this.db, id, modelReasoningEffort, namespace, options)
    }

    setSessionEffort(id: string, effort: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): boolean {
        return setSessionEffort(this.db, id, effort, namespace, options)
    }

    getSession(id: string): StoredSession | null {
        return getSession(this.db, id)
    }

    isSessionSoftDeleted(id: string): boolean {
        return isSessionSoftDeleted(this.db, id)
    }

    getSessionByNamespace(id: string, namespace: string): StoredSession | null {
        return getSessionByNamespace(this.db, id, namespace)
    }

    getSessionByNativeAlias(
        namespace: string,
        provider: 'claude' | 'codex',
        nativeSessionId: string
    ): StoredSession | null {
        return getSessionByNativeAlias(this.db, namespace, provider, nativeSessionId)
    }

    getSessions(): StoredSession[] {
        return getSessions(this.db)
    }

    getSessionsByNamespace(namespace: string): StoredSession[] {
        return getSessionsByNamespace(this.db, namespace)
    }

    deleteSession(id: string, namespace: string): boolean {
        return deleteSession(this.db, id, namespace)
    }

    syncNativeAliasesForSessionMetadata(id: string, namespace: string, metadata: unknown): void {
        syncNativeAliasesForSessionMetadata(this.db, id, namespace, metadata)
    }

    reconcileSessionTimestamps(
        id: string,
        namespace: string,
        payload: {
            createdAt: number
            lastActivityAt: number
        }
    ): StoredSession | null {
        return reconcileSessionTimestamps(this.db, id, namespace, payload)
    }
}
