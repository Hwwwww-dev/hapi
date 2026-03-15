import type { Database } from 'bun:sqlite'

import type { StoredMessage } from './types'
import { addMessage, getMessages, getMessagesAfter, importNativeMessage, mergeSessionMessages, type NativeMessageImportPayload } from './messages'

export class MessageStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    addMessage(sessionId: string, content: unknown, localId?: string): StoredMessage {
        return addMessage(this.db, sessionId, content, localId)
    }

    importNativeMessage(sessionId: string, payload: NativeMessageImportPayload): { message: StoredMessage; inserted: boolean } {
        return importNativeMessage(this.db, sessionId, payload)
    }

    getMessages(sessionId: string, limit: number = 200, beforeSeq?: number): StoredMessage[] {
        return getMessages(this.db, sessionId, limit, beforeSeq)
    }

    getMessagesAfter(sessionId: string, afterSeq: number, limit: number = 200): StoredMessage[] {
        return getMessagesAfter(this.db, sessionId, afterSeq, limit)
    }

    mergeSessionMessages(
        fromSessionId: string,
        toSessionId: string,
        options?: {
            strategy?: 'prepend-target' | 'append-source'
        }
    ): { moved: number; oldMaxSeq: number; newMaxSeq: number } {
        return mergeSessionMessages(this.db, fromSessionId, toSessionId, options)
    }
}
