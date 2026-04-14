import axios from 'axios'
import type { AgentState, CreateMachineResponse, CreateSessionResponse, RunnerState, Machine, MachineMetadata, Metadata, Session } from '@/api/types'
import {
    AgentStateSchema,
    CreateMachineResponseSchema,
    CreateSessionResponseSchema,
    ImportNativeMessagesResponseSchema,
    NativeSyncStateResponseSchema,
    RunnerStateSchema,
    MachineMetadataSchema,
    MetadataSchema,
    UpdateNativeSyncStateResponseSchema
} from '@/api/types'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { apiValidationError } from '@/utils/errorUtils'
import { ApiMachineClient } from './apiMachine'
import { ApiSessionClient } from './apiSession'
import type { NativeMessageImport, NativeSyncState } from '@/nativeSync/types'
import { buildHubRequestHeaders } from './hubExtraHeaders'

export class ApiClient {
    static async create(): Promise<ApiClient> {
        return new ApiClient(getAuthToken())
    }

    private constructor(private readonly token: string) { }

    async getOrCreateSession(opts: {
        tag: string
        existingSessionId?: string
        metadata: Metadata
        state: AgentState | null
        model?: string
        modelReasoningEffort?: string
        effort?: string
    }): Promise<Session> {
        const response = await axios.post<CreateSessionResponse>(
            `${configuration.apiUrl}/cli/sessions`,
            {
                tag: opts.tag,
                existingSessionId: opts.existingSessionId,
                metadata: opts.metadata,
                agentState: opts.state,
                model: opts.model,
                modelReasoningEffort: opts.modelReasoningEffort,
                effort: opts.effort
            },
            {
                headers: buildHubRequestHeaders({
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }),
                timeout: 60_000
            }
        )

        const parsed = CreateSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions response', response)
        }

        const raw = parsed.data.session

        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()

        const agentState = (() => {
            if (raw.agentState == null) return null
            const parsedAgentState = AgentStateSchema.safeParse(raw.agentState)
            return parsedAgentState.success ? parsedAgentState.data : null
        })()

        return {
            id: raw.id,
            namespace: raw.namespace,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            agentState,
            agentStateVersion: raw.agentStateVersion,
            thinking: raw.thinking,
            thinkingAt: raw.thinkingAt,
            todos: raw.todos,
            model: raw.model,
            modelReasoningEffort: raw.modelReasoningEffort,
            effort: raw.effort,
            permissionMode: raw.permissionMode,
            collaborationMode: raw.collaborationMode
        }
    }

    async getOrCreateMachine(opts: {
        machineId: string
        metadata: MachineMetadata
        runnerState?: RunnerState
    }): Promise<Machine> {
        const response = await axios.post<CreateMachineResponse>(
            `${configuration.apiUrl}/cli/machines`,
            {
                id: opts.machineId,
                metadata: opts.metadata,
                runnerState: opts.runnerState ?? null
            },
            {
                headers: buildHubRequestHeaders({
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }),
                timeout: 60_000
            }
        )

        const parsed = CreateMachineResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/machines response', response)
        }

        const raw = parsed.data.machine

        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MachineMetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()

        const runnerState = (() => {
            if (raw.runnerState == null) return null
            const parsedRunnerState = RunnerStateSchema.safeParse(raw.runnerState)
            return parsedRunnerState.success ? parsedRunnerState.data : null
        })()

        return {
            id: raw.id,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            runnerState,
            runnerStateVersion: raw.runnerStateVersion
        }
    }

    sessionSyncClient(session: Session): ApiSessionClient {
        return new ApiSessionClient(this.token, session)
    }

    machineSyncClient(machine: Machine): ApiMachineClient {
        return new ApiMachineClient(this.token, machine)
    }

    async upsertNativeSession(opts: {
        tag: string
        metadata: Metadata
        createdAt: number
        lastActivityAt: number
        agentState?: AgentState | null
    }): Promise<Session> {
        const response = await axios.post<CreateSessionResponse>(
            `${configuration.apiUrl}/cli/native/sessions/upsert`,
            {
                tag: opts.tag,
                metadata: opts.metadata,
                createdAt: opts.createdAt,
                lastActivityAt: opts.lastActivityAt,
                agentState: opts.agentState ?? null
            },
            {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60_000
            }
        )

        const parsed = CreateSessionResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/native/sessions/upsert response', response)
        }

        return this.parseSession(parsed.data.session)
    }

    async getNativeSyncState(sessionId: string): Promise<NativeSyncState | null> {
        const response = await axios.get(
            `${configuration.apiUrl}/cli/native/sessions/${encodeURIComponent(sessionId)}/sync-state`,
            {
                headers: {
                    Authorization: `Bearer ${this.token}`
                },
                timeout: 60_000
            }
        )

        const parsed = NativeSyncStateResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/native/sessions/:id/sync-state response', response)
        }

        return parsed.data.state
    }

    async importNativeMessages(sessionId: string, messages: NativeMessageImport[]): Promise<{ imported: number; session: Session }> {
        const response = await axios.post(
            `${configuration.apiUrl}/cli/native/sessions/${encodeURIComponent(sessionId)}/messages/import`,
            { messages },
            {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60_000
            }
        )

        const parsed = ImportNativeMessagesResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/native/sessions/:id/messages/import response', response)
        }

        return {
            imported: parsed.data.imported,
            session: this.parseSession(parsed.data.session)
        }
    }

    async updateNativeSyncState(state: NativeSyncState): Promise<NativeSyncState> {
        const response = await axios.post(
            `${configuration.apiUrl}/cli/native/sessions/${encodeURIComponent(state.sessionId)}/sync-state`,
            {
                provider: state.provider,
                nativeSessionId: state.nativeSessionId,
                machineId: state.machineId,
                cursor: state.cursor,
                filePath: state.filePath,
                mtime: state.mtime,
                lastSyncedAt: state.lastSyncedAt,
                syncStatus: state.syncStatus,
                lastError: state.lastError
            },
            {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60_000
            }
        )

        const parsed = UpdateNativeSyncStateResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/native/sessions/:id/sync-state response', response)
        }

        return parsed.data.state
    }

    private parseSession(raw: CreateSessionResponse['session']): Session {
        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()

        const agentState = (() => {
            if (raw.agentState == null) return null
            const parsedAgentState = AgentStateSchema.safeParse(raw.agentState)
            return parsedAgentState.success ? parsedAgentState.data : null
        })()

        return {
            id: raw.id,
            namespace: raw.namespace,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            agentState,
            agentStateVersion: raw.agentStateVersion,
            thinking: raw.thinking,
            thinkingAt: raw.thinkingAt,
            todos: raw.todos,
            model: raw.model,
            modelReasoningEffort: raw.modelReasoningEffort,
            effort: raw.effort,
            permissionMode: raw.permissionMode
        }
    }
}
