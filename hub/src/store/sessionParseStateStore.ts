import type { Database } from 'bun:sqlite'

import type { StoredSessionParseState } from './types'
import {
    getSessionParseStateBySessionId,
    upsertSessionParseState
} from './sessionParseState'

export class SessionParseStateStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getBySessionId(sessionId: string): StoredSessionParseState | null {
        return getSessionParseStateBySessionId(this.db, sessionId)
    }

    upsert(state: StoredSessionParseState): StoredSessionParseState {
        return upsertSessionParseState(this.db, state)
    }
}
