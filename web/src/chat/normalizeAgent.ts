import type { AgentEvent, NormalizedAgentContent, NormalizedMessage } from '@/chat/types'
import { AGENT_MESSAGE_PAYLOAD_TYPE, asNumber, asString, isObject, safeStringify } from '@hapi/protocol'
import { isClaudeChatVisibleMessage } from '@hapi/protocol/messages'
import { normalizeToolResultPermissions, parseToolResultBlock, parseToolUseBlock } from '@/chat/tool-utils'

const MAX_ASSISTANT_SOURCE_BLOCKS = 16
const MAX_THINKING_PARSE_TEXT_LENGTH = 64 * 1024
const MAX_THINKING_BLOCKS = 32
const MAX_REASONING_TEXT_LENGTH = 64 * 1024

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
        const toolUse = parseToolUseBlock(block, fallbackUuid, fallbackParentUUID)
        if (toolUse) { normalized.push(toolUse); continue }
        const toolResult = parseToolResultBlock(block, fallbackUuid, fallbackParentUUID)
        if (toolResult) { normalized.push(toolResult) }
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
        blocks.push(...normalizeAssistantBlocks(modelContent, uuid, parentUUID))
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

    // Handle system-injected messages that arrive as type:'user' through
    // the agent output path. Real user text goes through normalizeUserRecord.
    //
    // All string-content user messages here are system-injected (subagent
    // prompts, task notifications, system reminders, etc.).  Always emit as
    // sidechain so the uuid/parentUUID chain is preserved — the reducer uses
    // sidechain UUIDs to identify sentinel auto-replies.  Task-notification
    // summaries are extracted as events by the reducer, not here.
    if (typeof messageContent === 'string') {
        return {
            id: messageId,
            localId,
            createdAt,
            role: 'agent',
            isSidechain: true,
            content: [{ type: 'sidechain', uuid, parentUUID, prompt: messageContent }]
        }
    }

    // Sidechain user messages with array content (e.g. subagent prompts
    // that Claude Code serialised as [{type:'text', text:'...'}] instead
    // of a plain string).  Extract the text and treat as sidechain so the
    // tracer can match it to the parent Task tool call.
    if (isSidechain && Array.isArray(messageContent)) {
        const textParts = messageContent
            .filter((b: unknown) => isObject(b) && b.type === 'text' && typeof b.text === 'string')
            .map((b: Record<string, unknown>) => b.text as string)
        if (textParts.length > 0) {
            return {
                id: messageId,
                localId,
                createdAt,
                role: 'agent',
                isSidechain: true,
                content: [{ type: 'sidechain', uuid, parentUUID, prompt: textParts.join('\n\n') }]
            }
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
    return isObject(content) && content.type === AGENT_MESSAGE_PAYLOAD_TYPE
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

    if (content.type === AGENT_MESSAGE_PAYLOAD_TYPE) {
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
