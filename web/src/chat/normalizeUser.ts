import type { NormalizedAgentContent, NormalizedMessage } from '@/chat/types'
import type { AttachmentMetadata } from '@/types/api'
import { isObject } from '@hapi/protocol'
import { parseToolResultBlock } from '@/chat/tool-utils'

function parseAttachments(raw: unknown): AttachmentMetadata[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const attachments: AttachmentMetadata[] = []
    for (const item of raw) {
        if (
            isObject(item) &&
            typeof item.id === 'string' &&
            typeof item.filename === 'string' &&
            typeof item.mimeType === 'string' &&
            typeof item.size === 'number' &&
            typeof item.path === 'string'
        ) {
            attachments.push({
                id: item.id,
                filename: item.filename,
                mimeType: item.mimeType,
                size: item.size,
                path: item.path,
                previewUrl: typeof item.previewUrl === 'string' ? item.previewUrl : undefined
            })
        }
    }
    return attachments.length > 0 ? attachments : undefined
}

export function normalizeUserRecord(
    messageId: string,
    localId: string | null,
    createdAt: number,
    content: unknown,
    meta?: unknown
): NormalizedMessage | null {
    if (typeof content === 'string') {
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'user',
            content: { type: 'text', text: content },
            isSidechain: false,
            meta
        }
    }

    if (isObject(content) && content.type === 'text' && typeof content.text === 'string') {
        const attachments = parseAttachments(content.attachments)
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'user',
            content: { type: 'text', text: content.text, attachments },
            isSidechain: false,
            meta
        }
    }

    if (Array.isArray(content)) {
        const userTexts: string[] = []
        const agentBlocks: NormalizedAgentContent[] = []

        for (const block of content) {
            if (!isObject(block) || typeof block.type !== 'string') continue

            if (block.type === 'text' && typeof block.text === 'string') {
                userTexts.push(block.text)
                agentBlocks.push({
                    type: 'text',
                    text: block.text,
                    uuid: messageId,
                    parentUUID: null
                })
                continue
            }

            if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                const toolResult = parseToolResultBlock(block, messageId, null)
                if (toolResult) agentBlocks.push(toolResult)
            }
        }

        const hasToolResults = agentBlocks.some((block) => block.type === 'tool-result')
        if (hasToolResults) {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                content: agentBlocks,
                isSidechain: false,
                meta
            }
        }

        if (userTexts.length > 0) {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'user',
                content: { type: 'text', text: userTexts.join('\n\n') },
                isSidechain: false,
                meta
            }
        }
    }

    return null
}
