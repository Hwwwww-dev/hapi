import type { Database } from 'bun:sqlite'
import type { RawEventEnvelope } from '@hapi/protocol'

import type { RawEventIngestResult, StoredRawEvent } from './types'
import {
    ingestRawEvent,
    listRawEventsBySession,
    listRawEventsForParserReplay,
    listRuntimeRawEventsAfterIngestSeq,
    rehomeSessionRawEvents
} from './rawEvents'

export class RawEventStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    ingest(event: RawEventEnvelope): RawEventIngestResult {
        return ingestRawEvent(this.db, event)
    }

    listBySession(sessionId: string): StoredRawEvent[] {
        return listRawEventsBySession(this.db, sessionId)
    }

    listForParserReplay(sessionId: string): StoredRawEvent[] {
        return listRawEventsForParserReplay(this.db, sessionId)
    }

    listRuntimeAfterIngestSeq(sessionId: string, afterIngestSeq: number, limit: number = 200): StoredRawEvent[] {
        return listRuntimeRawEventsAfterIngestSeq(this.db, sessionId, afterIngestSeq, limit)
    }

    rehomeSession(sourceSessionId: string, targetSessionId: string): number {
        return rehomeSessionRawEvents(this.db, sourceSessionId, targetSessionId)
    }
}
