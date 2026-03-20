import type { AgentEvent, NormalizedAgentContent, NormalizedMessage, ToolResultPermission } from '@/chat/types'
import { asNumber, asString, isObject, safeStringify } from '@hapi/protocol'
import { isClaudeChatVisibleMessage } from '@hapi/protocol/messages'

const MAX_ASSISTANT_SOURCE_BLOCKS = 16
const MAX_THINKING_PARSE_TEXT_LENGTH = 64 * 1024
const MAX_THINKING_BLOCKS = 32
const MAX_REASONING_TEXT_LENGTH = 64 * 1024

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

function normalizeAgentEvent(value: unknown): AgentEvent | null {
    if (!isObject(value) || typeof value.type !== 'string') return null
    return value as AgentEvent
}

function toTextContent(
    text: string,
    uuid: string,
    parentUUID: string | null
): NormalizedAgentContent[] {
    return [{ type: 'text', text, uuid, parentUUID }]
}

function toReasoningContent(
    text: string,
    uuid: string,
    parentUUID: string | null
): NormalizedAgentContent {
    if (text.length <= MAX_REASONING_TEXT_LENGTH) {
        return { type: 'reasoning', text, uuid, parentUUID }
    }

    return {
        type: 'reasoning',
        text: text.slice(0, MAX_REASONING_TEXT_LENGTH),
        truncated: true,
        uuid,
        parentUUID
    }
}

function normalizeThinkingTaggedText(
    text: string,
    uuid: string,
    parentUUID: string | null
): NormalizedAgentContent[] {
    if (
        text.length > MAX_THINKING_PARSE_TEXT_LENGTH
        || !text.includes('<thinking>')
        || !text.includes('</thinking>')
    ) {
        return toTextContent(text, uuid, parentUUID)
    }

    const blocks: NormalizedAgentContent[] = []
    const pattern = /<thinking>([\s\S]*?)<\/thinking>/gi
    let lastIndex = 0
    let matchCount = 0

    for (const match of text.matchAll(pattern)) {
        matchCount += 1
        if (matchCount > MAX_THINKING_BLOCKS) {
            return toTextContent(text, uuid, parentUUID)
        }

        const index = match.index ?? 0
        const before = text.slice(lastIndex, index).trim()
        if (before.length > 0) {
            blocks.push({ type: 'text', text: before, uuid, parentUUID })
        }

        const thinkingText = (match[1] ?? '').trim()
        if (thinkingText.length > 0) {
            blocks.push(toReasoningContent(thinkingText, uuid, parentUUID))
        }

        lastIndex = index + match[0].length
    }

    if (blocks.length === 0) {
        return toTextContent(text, uuid, parentUUID)
    }

    const trailing = text.slice(lastIndex).trim()
    if (trailing.length > 0) {
        blocks.push({ type: 'text', text: trailing, uuid, parentUUID })
    }

    return blocks
}

function collapseAssistantContent(
    value: unknown,
    uuid: string,
    parentUUID: string | null
): NormalizedAgentContent[] {
    return toTextContent(
        typeof value === 'string' ? value : safeStringify(value),
        uuid,
        parentUUID
    )
}

function appendNormalizedTextBlocks(
    target: NormalizedAgentContent[],
    text: string,
    uuid: string,
    parentUUID: string | null
): void {
    target.push(...normalizeThinkingTaggedText(text, uuid, parentUUID))
}

function normalizeAssistantBlocks(
    blocks: unknown[],
    fallbackUuid: string,
    fallbackParentUUID: string | null
): NormalizedAgentContent[] {
    if (blocks.length > MAX_ASSISTANT_SOURCE_BLOCKS) {
        return collapseAssistantContent(blocks, fallbackUuid, fallbackParentUUID)
    }

    const normalized: NormalizedAgentContent[] = []

    for (const block of blocks) {
        if (!isObject(block) || typeof block.type !== 'string') continue
        if (block.type === 'text' && typeof block.text === 'string') {
            appendNormalizedTextBlocks(normalized, block.text, fallbackUuid, fallbackParentUUID)
            continue
        }
        if (block.type === 'thinking' && typeof block.thinking === 'string') {
            normalized.push(toReasoningContent(block.thinking, fallbackUuid, fallbackParentUUID))
            continue
        }
        if ((block.type === 'tool_use' || block.type === 'tool_call') && typeof block.id === 'string') {
            const name = asString(block.name) ?? 'Tool'
            const input = 'input' in block ? (block as Record<string, unknown>).input : undefined
            const description = isObject(input) && typeof input.description === 'string' ? input.description : null
            normalized.push({ type: 'tool-call', id: block.id, name, input, description, uuid: fallbackUuid, parentUUID: fallbackParentUUID })
            continue
        }
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            normalized.push({
                type: 'tool-result',
                tool_use_id: block.tool_use_id,
                content: 'content' in block ? (block as Record<string, unknown>).content : undefined,
                is_error: Boolean(block.is_error),
                uuid: fallbackUuid,
                parentUUID: fallbackParentUUID,
                permissions: normalizeToolResultPermissions(block.permissions)
            })
        }
    }

    return normalized
}

function normalizeAssistantOutput(
    messageId: string,
    localId: string | null,
    createdAt: number,
    data: Record<string, unknown>,
    meta?: unknown
): NormalizedMessage | null {
    const uuid = asString(data.uuid) ?? messageId
    const parentUUID = asString(data.parentUuid) ?? null
    const isSidechain = Boolean(data.isSidechain)

    const message = isObject(data.message) ? data.message : null
    if (!message) return null

    const modelContent = message.content
    const blocks: NormalizedAgentContent[] = []

    if (typeof modelContent === 'string') {
        appendNormalizedTextBlocks(blocks, modelContent, uuid, parentUUID)
    } else if (Array.isArray(modelContent)) {
        if (modelContent.length > MAX_ASSISTANT_SOURCE_BLOCKS) {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain,
                content: collapseAssistantContent(modelContent, uuid, parentUUID),
                meta
            }
        }

        for (const block of modelContent) {
            if (!isObject(block) || typeof block.type !== 'string') continue
            if (block.type === 'text' && typeof block.text === 'string') {
                appendNormalizedTextBlocks(blocks, block.text, uuid, parentUUID)
                continue
            }
            if (block.type === 'thinking' && typeof block.thinking === 'string') {
                blocks.push(toReasoningContent(block.thinking, uuid, parentUUID))
                continue
            }
            if ((block.type === 'tool_use' || block.type === 'tool_call') && typeof block.id === 'string') {
                const name = asString(block.name) ?? 'Tool'
                const input = 'input' in block ? (block as Record<string, unknown>).input : undefined
                const description = isObject(input) && typeof input.description === 'string' ? input.description : null
                blocks.push({ type: 'tool-call', id: block.id, name, input, description, uuid, parentUUID })
                continue
            }
            if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                blocks.push({
                    type: 'tool-result',
                    tool_use_id: block.tool_use_id,
                    content: 'content' in block ? (block as Record<string, unknown>).content : undefined,
                    is_error: Boolean(block.is_error),
                    uuid,
                    parentUUID,
                    permissions: normalizeToolResultPermissions(block.permissions)
                })
            }
        }
    }

    const usage = isObject(message.usage) ? (message.usage as Record<string, unknown>) : null
    const inputTokens = usage ? asNumber(usage.input_tokens) : null
    const outputTokens = usage ? asNumber(usage.output_tokens) : null

    return {
        id: messageId,
        localId,
        createdAt,
        role: 'agent',
        isSidechain,
        content: blocks,
        meta,
        usage: inputTokens !== null && outputTokens !== null ? {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: asNumber(usage?.cache_creation_input_tokens) ?? undefined,
            cache_read_input_tokens: asNumber(usage?.cache_read_input_tokens) ?? undefined,
            service_tier: asString(usage?.service_tier) ?? undefined
        } : undefined
    }
}

function normalizeUserOutput(
    messageId: string,
    localId: string | null,
    createdAt: number,
    data: Record<string, unknown>,
    meta?: unknown
): NormalizedMessage | null {
    const uuid = asString(data.uuid) ?? messageId
    const parentUUID = asString(data.parentUuid) ?? null
    const isSidechain = Boolean(data.isSidechain)

    const message = isObject(data.message) ? data.message : null
    if (!message) return null

    const messageContent = message.content

    // Sidechain root message: extract prompt text from string or array content
    if (isSidechain) {
        let prompt: string | null = null
        if (typeof messageContent === 'string') {
            prompt = messageContent
        } else if (
            Array.isArray(messageContent) &&
            messageContent.length >= 1 &&
            isObject(messageContent[0]) &&
            messageContent[0].type === 'text' &&
            typeof messageContent[0].text === 'string'
        ) {
            prompt = messageContent[0].text
        }
        if (prompt !== null) {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: true,
                content: [{ type: 'sidechain', uuid, parentUUID, prompt }]
            }
        }
    }

    if (typeof messageContent === 'string') {
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'user',
            isSidechain: false,
            content: { type: 'text', text: messageContent },
            meta
        }
    }

    // When content is an array with a single text element, normalize to user role
    // so that skill-content / compact messages are rendered by UserMessage
    if (
        Array.isArray(messageContent) &&
        messageContent.length === 1 &&
        isObject(messageContent[0]) &&
        messageContent[0].type === 'text' &&
        typeof messageContent[0].text === 'string'
    ) {
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'user',
            isSidechain: false,
            content: { type: 'text', text: messageContent[0].text },
            meta
        }
    }

    const blocks: NormalizedAgentContent[] = []

    if (Array.isArray(messageContent)) {
        for (const block of messageContent) {
            if (!isObject(block) || typeof block.type !== 'string') continue
            if (block.type === 'text' && typeof block.text === 'string') {
                blocks.push({ type: 'text', text: block.text, uuid, parentUUID })
                continue
            }
            if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                const isError = Boolean(block.is_error)
                const rawContent = 'content' in block ? (block as Record<string, unknown>).content : undefined
                const embeddedToolUseResult = 'toolUseResult' in data ? (data as Record<string, unknown>).toolUseResult : null

                const permissions = normalizeToolResultPermissions(block.permissions)

                blocks.push({
                    type: 'tool-result',
                    tool_use_id: block.tool_use_id,
                    content: embeddedToolUseResult ?? rawContent,
                    is_error: isError,
                    uuid,
                    parentUUID,
                    permissions
                })
            }
        }
    }

    return {
        id: messageId,
        localId,
        createdAt,
        role: 'agent',
        isSidechain,
        content: blocks,
        meta
    }
}

export function isSkippableAgentContent(content: unknown): boolean {
    if (!isObject(content) || content.type !== 'output') return false
    const data = isObject(content.data) ? content.data : null
    if (!data) return false
    if (Boolean(data.isMeta) || Boolean(data.isCompactSummary)) return true
    return !isClaudeChatVisibleMessage({ type: data.type, subtype: data.subtype })
}

export function isCodexContent(content: unknown): boolean {
    return isObject(content) && content.type === 'codex'
}

function getCodexToolCallId(data: Record<string, unknown>): string | null {
    return asString(data.callId)
        ?? asString(data.id)
        ?? asString(data.tool_use_id)
        ?? asString(data.toolUseId)
}

export function normalizeAgentRecord(
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
            role: 'agent',
            isSidechain: false,
            content: normalizeThinkingTaggedText(content, messageId, null),
            meta
        }
    }

    if (Array.isArray(content)) {
        const blocks = normalizeAssistantBlocks(content, messageId, null)
        if (blocks.length === 0) return null
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'agent',
            isSidechain: false,
            content: blocks,
            meta
        }
    }

    if (!isObject(content) || typeof content.type !== 'string') return null

    if (content.type === 'output') {
        const data = isObject(content.data) ? content.data : null
        if (!data || typeof data.type !== 'string') return null

        // Skip meta/compact-summary messages (parity with hapi-app)
        if (data.isMeta) return null
        if (data.isCompactSummary) return null
        if (!isClaudeChatVisibleMessage({ type: data.type, subtype: data.subtype })) return null

        if (data.type === 'assistant') {
            return normalizeAssistantOutput(messageId, localId, createdAt, data, meta)
        }
        if (data.type === 'user') {
            return normalizeUserOutput(messageId, localId, createdAt, data, meta)
        }
        if (data.type === 'summary' && typeof data.summary === 'string') {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{ type: 'summary', summary: data.summary }],
                meta
            }
        }
        if (data.type === 'system' && data.subtype === 'api_error') {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'event',
                content: {
                    type: 'api-error',
                    retryAttempt: asNumber(data.retryAttempt) ?? 0,
                    maxRetries: asNumber(data.maxRetries) ?? 0,
                    error: data.error
                },
                isSidechain: false,
                meta
            }
        }
        if (data.type === 'system' && data.subtype === 'turn_duration') {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'event',
                content: {
                    type: 'turn-duration',
                    durationMs: asNumber(data.durationMs) ?? 0
                },
                isSidechain: false,
                meta
            }
        }
        if (data.type === 'system' && data.subtype === 'microcompact_boundary') {
            const metadata = isObject(data.microcompactMetadata) ? data.microcompactMetadata : null
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'event',
                content: {
                    type: 'microcompact',
                    trigger: asString(metadata?.trigger) ?? 'auto',
                    preTokens: asNumber(metadata?.preTokens) ?? 0,
                    tokensSaved: asNumber(metadata?.tokensSaved) ?? 0
                },
                isSidechain: false,
                meta
            }
        }
        if (data.type === 'system' && data.subtype === 'compact_boundary') {
            const metadata = isObject(data.compactMetadata) ? data.compactMetadata : null
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'event',
                content: {
                    type: 'compact',
                    trigger: asString(metadata?.trigger) ?? 'auto',
                    preTokens: asNumber(metadata?.preTokens) ?? 0
                },
                isSidechain: false,
                meta
            }
        }
        return null
    }

    if (content.type === 'event') {
        const event = normalizeAgentEvent(content.data)
        if (!event) return null
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'event',
            content: event,
            isSidechain: false,
            meta
        }
    }

    if (content.type === 'codex') {
        const data = isObject(content.data) ? content.data : null
        if (!data || typeof data.type !== 'string') return null

        if (data.type === 'message' && typeof data.message === 'string') {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: normalizeThinkingTaggedText(data.message, messageId, null),
                meta
            }
        }

        if (data.type === 'reasoning' && typeof data.message === 'string') {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [toReasoningContent(data.message, messageId, null)],
                meta
            }
        }

        if ((data.type === 'tool-call' || data.type === 'tool_call')) {
            const callId = getCodexToolCallId(data)
            if (!callId) return null
            const uuid = asString(data.id) ?? messageId
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{
                    type: 'tool-call',
                    id: callId,
                    name: asString(data.name) ?? 'unknown',
                    input: data.input,
                    description: null,
                    uuid,
                    parentUUID: null
                }],
                meta
            }
        }

        if ((data.type === 'tool-call-result' || data.type === 'tool_result')) {
            const callId = getCodexToolCallId(data)
            if (!callId) return null
            const uuid = asString(data.id) ?? messageId
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{
                    type: 'tool-result',
                    tool_use_id: callId,
                    content: data.output ?? data.content,
                    is_error: Boolean(data.is_error),
                    uuid,
                    parentUUID: null
                }],
                meta
            }
        }

        if (data.type === 'plan' && Array.isArray(data.entries)) {
            const uuid = asString(data.id) ?? messageId
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: false,
                content: [{
                    type: 'tool-call',
                    id: `plan:${messageId}`,
                    name: 'update_plan',
                    input: { plan: data.entries },
                    description: null,
                    uuid,
                    parentUUID: null
                }],
                meta
            }
        }
    }

    return null
}
