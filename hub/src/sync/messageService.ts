import type { AttachmentMetadata, DecryptedMessage } from '@hapi/protocol/types'
import type { Server } from 'socket.io'
import type { Store } from '../store'
import { EventPublisher } from './eventPublisher'
import { maybeApplyFirstMessageSessionTitle } from './sessionTitle'

export class MessageService {
    constructor(
        private readonly store: Store,
        private readonly io: Server,
        private readonly publisher: EventPublisher,
        private readonly onSessionTouched: (sessionId: string) => void
    ) {
    }

    getMessagesPage(sessionId: string, options: { limit: number; beforeSeq: number | null }): {
        messages: DecryptedMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
            total: number
        }
    } {
        // 1. Fetch root (non-sidechain) messages for pagination
        const rootStored = this.store.messages.getRootMessages(sessionId, options.limit, options.beforeSeq ?? undefined)
        const totalRoot = this.store.messages.countRootMessages(sessionId)

        // 2. Determine seq range of root messages, then fetch sidechain messages in that range
        //    When loading the newest page (beforeSeq=null), don't cap the upper bound
        //    so that sidechain messages from a still-running Agent are included.
        let allStored = rootStored
        if (rootStored.length > 0) {
            const minSeq = rootStored[0].seq
            const maxSeq = rootStored[rootStored.length - 1].seq
            const isNewestPage = options.beforeSeq === null
            const sidechainStored = isNewestPage
                ? this.store.messages.getSidechainMessagesFrom(sessionId, 1)
                : this.store.messages.getSidechainMessagesInRange(sessionId, minSeq, maxSeq)
            allStored = [...rootStored, ...sidechainStored].sort((a, b) => a.seq - b.seq)
        }

        const messages: DecryptedMessage[] = allStored.map((message) => ({
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt
        }))

        // 3. Compute pagination based on root messages only
        let oldestRootSeq: number | null = null
        for (const msg of rootStored) {
            if (typeof msg.seq !== 'number') continue
            if (oldestRootSeq === null || msg.seq < oldestRootSeq) {
                oldestRootSeq = msg.seq
            }
        }

        const nextBeforeSeq = oldestRootSeq
        const hasMore = nextBeforeSeq !== null
            && this.store.messages.hasRootMessagesBefore(sessionId, nextBeforeSeq)

        return {
            messages,
            page: {
                limit: options.limit,
                beforeSeq: options.beforeSeq,
                nextBeforeSeq,
                hasMore,
                total: totalRoot
            }
        }
    }

    getMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        const stored = this.store.messages.getMessagesAfter(sessionId, options.afterSeq, options.limit)
        return stored.map((message) => ({
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt
        }))
    }

    importNativeMessages(
        sessionId: string,
        messages: Array<{
            content: unknown
            createdAt: number
            sourceProvider: 'claude' | 'codex'
            sourceSessionId: string
            sourceKey: string
        }>
    ): { imported: number; messages: DecryptedMessage[] } {
        let imported = 0
        const importedMessages: DecryptedMessage[] = []

        for (const item of messages) {
            const result = this.store.messages.importNativeMessage(sessionId, item)
            if (!result.inserted && !result.updated) {
                continue
            }

            if (result.inserted) {
                imported += 1
            }

            let sessionTitleUpdated = false
            if (result.inserted) {
                sessionTitleUpdated = maybeApplyFirstMessageSessionTitle(this.store, sessionId, result.message.content, result.message.createdAt)
            }

            const message: DecryptedMessage = {
                id: result.message.id,
                seq: result.message.seq,
                localId: result.message.localId,
                content: result.message.content,
                createdAt: result.message.createdAt
            }
            if (result.inserted) {
                importedMessages.push(message)
                this.broadcastNewMessage(sessionId, message)
            }

            if (sessionTitleUpdated) {
                this.broadcastSessionUpdated(sessionId)
            }
        }

        return { imported, messages: importedMessages }
    }

    async sendMessage(
        sessionId: string,
        payload: {
            text: string
            localId?: string | null
            attachments?: AttachmentMetadata[]
            sentFrom?: 'telegram-bot' | 'webapp'
        }
    ): Promise<void> {
        const sentFrom = payload.sentFrom ?? 'webapp'

        const content = {
            role: 'user',
            content: {
                type: 'text',
                text: payload.text,
                attachments: payload.attachments
            },
            meta: {
                sentFrom
            }
        }

        const msg = this.store.messages.addMessage(sessionId, content, payload.localId ?? undefined)
        maybeApplyFirstMessageSessionTitle(this.store, sessionId, msg.content, msg.createdAt)
        this.broadcastNewMessage(sessionId, {
            id: msg.id,
            seq: msg.seq,
            localId: msg.localId,
            content: msg.content,
            createdAt: msg.createdAt
        })
        this.broadcastSessionUpdated(sessionId)
    }

    private broadcastNewMessage(sessionId: string, message: DecryptedMessage): void {
        const update = {
            id: message.id,
            seq: message.seq,
            createdAt: message.createdAt,
            body: {
                t: 'new-message' as const,
                sid: sessionId,
                message
            }
        }
        this.io.of('/cli').to(`session:${sessionId}`).emit('update', update)

        this.publisher.emit({
            type: 'message-received',
            sessionId,
            message
        })
    }

    private broadcastSessionUpdated(sessionId: string): void {
        this.onSessionTouched(sessionId)
    }
}
