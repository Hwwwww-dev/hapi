import type { NormalizedAgentContent, NormalizedMessage, ToolResultPermission } from '@/chat/types'
import type { AttachmentMetadata } from '@/types/api'
import { asNumber, asString, isObject } from '@hapi/protocol'

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

function normalizeToolResultPermissions(value: unknown): ToolResultPermission | undefined {
    if (!isObject(value)) return undefined
    const date = asNumber(value.date)
    const result = value.result
    if (date === null) return undefined
    if (result !== 'approved' && result !== 'denied') return undefined

    const mode = asString(value.mode) ?? undefined
    const allowedTools = Array.isArray(value.allowedTools)
        ? value.allowedTools.filter((tool) => typeof tool === 'string')
        : undefined
    const decision = value.decision
    const normalizedDecision = decision === 'approved' || decision === 'approved_for_session' || decision === 'denied' || decision === 'abort'
        ? decision
        : undefined

    return {
        date,
        result,
        mode,
        allowedTools,
        decision: normalizedDecision
    }
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
                agentBlocks.push({
                    type: 'tool-result',
                    tool_use_id: block.tool_use_id,
                    content: 'content' in block ? (block as Record<string, unknown>).content : undefined,
                    is_error: Boolean(block.is_error),
                    uuid: messageId,
                    parentUUID: null,
                    permissions: normalizeToolResultPermissions(block.permissions)
                })
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
