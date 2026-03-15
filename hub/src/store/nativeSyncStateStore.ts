import type { Database } from 'bun:sqlite'

import type { StoredNativeSyncState } from './types'
import {
    getNativeSyncStateBySessionId,
    listNativeSyncStateByMachine,
    markNativeSyncStateError,
    upsertNativeSyncState
} from './nativeSyncState'

export class NativeSyncStateStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getBySessionId(sessionId: string): StoredNativeSyncState | null {
        return getNativeSyncStateBySessionId(this.db, sessionId)
    }

    listByMachine(machineId: string): StoredNativeSyncState[] {
        return listNativeSyncStateByMachine(this.db, machineId)
    }

    upsert(state: StoredNativeSyncState): StoredNativeSyncState {
        return upsertNativeSyncState(this.db, state)
    }

    markError(sessionId: string, message: string, timestamp: number): StoredNativeSyncState | null {
        return markNativeSyncStateError(this.db, sessionId, message, timestamp)
    }
}
