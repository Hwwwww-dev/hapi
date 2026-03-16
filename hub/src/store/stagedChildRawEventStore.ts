import type { Database } from 'bun:sqlite'

import type { StoredStagedChildRawEvent } from './types'
import {
    deleteStagedChildRawEventsByChildIdentity,
    listAllStagedChildRawEvents,
    rehomeStagedChildRawEventsToSession,
    stageStagedChildRawEvent,
    type RehomeStagedChildRawEventsParams
} from './stagedChildRawEvents'

export class StagedChildRawEventStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    stage(event: StoredStagedChildRawEvent): StoredStagedChildRawEvent {
        return stageStagedChildRawEvent(this.db, event)
    }

    listAll(): StoredStagedChildRawEvent[] {
        return listAllStagedChildRawEvents(this.db)
    }

    deleteByChildIdentity(childIdentity: string): number {
        return deleteStagedChildRawEventsByChildIdentity(this.db, childIdentity)
    }

    rehomeToSession(params: RehomeStagedChildRawEventsParams): number {
        return rehomeStagedChildRawEventsToSession(this.db, params)
    }
}
