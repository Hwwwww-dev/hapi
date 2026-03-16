import type { CanonicalBlock, CanonicalRootBlock } from '@hapi/protocol'
import type { AttachmentMetadata } from '@/types/api'
import type { ChatToolCall, ToolPermission } from '@/chat/types'
import { isObject, safeStringify } from '@hapi/protocol'

const TOOL_PENDING_STATES = new Set(['pending', 'requires-action'])
const TOOL_RUNNING_STATES = new Set(['running', 'streaming', 'in-progress'])
const TOOL_COMPLETED_STATES = new Set(['complete', 'completed', 'done', 'success'])
const TOOL_ERROR_STATES = new Set(['error', 'failed', 'canceled', 'cancelled', 'denied', 'aborted'])

type CanonicalRenderBlockBase = {
    renderSource: 'canonical'
    id: string
    kind: CanonicalBlock['kind']
    createdAt: number
    updatedAt: number
    timelineSeq: number
    siblingSeq: number
    state: string
    generation: number
    parserVersion: number
    sourceRawEventIds: string[]
    payload: Record<string, unknown>
    children: CanonicalRenderBlock[]
}

export type CanonicalUserTextRenderBlock = CanonicalRenderBlockBase & {
    kind: 'user-text'
    text: string
    attachments?: AttachmentMetadata[]
}

export type CanonicalAgentTextRenderBlock = CanonicalRenderBlockBase & {
    kind: 'agent-text'
    text: string
}

export type CanonicalReasoningRenderBlock = CanonicalRenderBlockBase & {
    kind: 'reasoning'
    text: string
}

export type CanonicalEventRenderBlock = CanonicalRenderBlockBase & {
    kind: 'event'
    text: string
    subtype: string | null
}

export type CanonicalToolCallRenderBlock = CanonicalRenderBlockBase & {
    kind: 'tool-call'
    tool: ChatToolCall
}

export type CanonicalToolResultRenderBlock = CanonicalRenderBlockBase & {
    kind: 'tool-result'
    tool: ChatToolCall
}

export type CanonicalSubagentRenderBlock = CanonicalRenderBlockBase & {
    kind: 'subagent-root'
    title: string | null
    description: string | null
    subagentId: string | null
    lifecycleState: string
}

export type CanonicalFallbackRawRenderBlock = CanonicalRenderBlockBase & {
    kind: 'fallback-raw'
    provider: string | null
    rawType: string | null
    summary: string | null
    preview: unknown
}

export type CanonicalRenderBlock =
    | CanonicalUserTextRenderBlock
    | CanonicalAgentTextRenderBlock
    | CanonicalReasoningRenderBlock
    | CanonicalEventRenderBlock
    | CanonicalToolCallRenderBlock
    | CanonicalToolResultRenderBlock
    | CanonicalSubagentRenderBlock
    | CanonicalFallbackRawRenderBlock

export type CanonicalToolArtifact = Extract<CanonicalRenderBlock, {
    kind: 'tool-call' | 'tool-result' | 'subagent-root' | 'fallback-raw'
}>

function getPayloadRecord(block: CanonicalBlock): Record<string, unknown> {
    return isObject(block.payload) ? block.payload : {}
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key)
}

function getUnknown(payload: Record<string, unknown>, ...keys: string[]): unknown {
    for (const key of keys) {
        if (hasOwn(payload, key)) {
            return payload[key]
        }
    }
    return undefined
}

function getString(payload: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
        const value = getUnknown(payload, key)
        if (typeof value === 'string') {
            const trimmed = value.trim()
            if (trimmed.length > 0) return trimmed
        }
    }
    return null
}

function getBoolean(payload: Record<string, unknown>, ...keys: string[]): boolean | null {
    for (const key of keys) {
        const value = getUnknown(payload, key)
        if (typeof value === 'boolean') return value
    }
    return null
}

function getObject(payload: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
    for (const key of keys) {
        const value = getUnknown(payload, key)
        if (isObject(value)) return value
    }
    return null
}

function getAttachments(payload: Record<string, unknown>): AttachmentMetadata[] | undefined {
    const value = getUnknown(payload, 'attachments')
    if (!Array.isArray(value)) return undefined

    const attachments = value.filter((entry): entry is AttachmentMetadata => isObject(entry))
    return attachments.length > 0 ? attachments : undefined
}

function getText(payload: Record<string, unknown>): string {
    const text = getString(payload, 'text', 'summary', 'message')
    if (text) return text

    const content = getUnknown(payload, 'content')
    if (typeof content === 'string' && content.trim().length > 0) {
        return content.trim()
    }

    return safeStringify(payload)
}

function normalizeToolState(rawState: string | null | undefined): ChatToolCall['state'] {
    const normalized = rawState?.trim().toLowerCase() ?? ''
    if (TOOL_PENDING_STATES.has(normalized)) return 'pending'
    if (TOOL_RUNNING_STATES.has(normalized)) return 'running'
    if (TOOL_COMPLETED_STATES.has(normalized)) return 'completed'
    if (TOOL_ERROR_STATES.has(normalized)) return 'error'
    return 'running'
}

function normalizePermission(value: unknown, fallbackId: string): ToolPermission | undefined {
    if (!isObject(value)) return undefined

    const status = value.status
    if (status !== 'pending' && status !== 'approved' && status !== 'denied' && status !== 'canceled') {
        return undefined
    }

    const allowedTools = Array.isArray(value.allowedTools)
        ? value.allowedTools.filter((tool): tool is string => typeof tool === 'string')
        : undefined

    return {
        id: typeof value.id === 'string' && value.id.length > 0 ? value.id : fallbackId,
        status,
        reason: typeof value.reason === 'string' ? value.reason : undefined,
        mode: typeof value.mode === 'string' ? value.mode : undefined,
        decision: value.decision === 'approved'
            || value.decision === 'approved_for_session'
            || value.decision === 'denied'
            || value.decision === 'abort'
            ? value.decision
            : undefined,
        allowedTools: allowedTools && allowedTools.length > 0 ? allowedTools : undefined,
        answers: isObject(value.answers) ? value.answers as ToolPermission['answers'] : undefined,
        date: typeof value.date === 'number' ? value.date : undefined,
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : null,
        completedAt: typeof value.completedAt === 'number' ? value.completedAt : null
    }
}

function toTool(payload: Record<string, unknown>, block: CanonicalBlock, defaultName: string): ChatToolCall {
    const toolId = getString(payload, 'toolCallId', 'toolResultId', 'toolId', 'id') ?? block.id
    const normalizedState = normalizeToolState(
        getString(payload, 'toolState', 'state') ?? block.state
    )

    return {
        id: toolId,
        name: getString(payload, 'toolName', 'name') ?? defaultName,
        state: normalizedState,
        input: getUnknown(payload, 'input', 'args') ?? {},
        createdAt: block.createdAt,
        startedAt: normalizedState === 'running' ? block.createdAt : null,
        completedAt: normalizedState === 'completed' || normalizedState === 'error' ? block.updatedAt : null,
        description: getString(payload, 'description', 'summary'),
        result: getUnknown(payload, 'result', 'output', 'content'),
        permission: normalizePermission(getUnknown(payload, 'permission'), toolId)
    }
}

function formatEventText(payload: Record<string, unknown>): string {
    const subtype = getString(payload, 'subtype')
    const summary = getString(payload, 'summary', 'text', 'message')

    switch (subtype) {
        case 'title-changed': {
            const title = getString(payload, 'title')
            return title ? `Title changed to "${title}"` : 'Title changed'
        }
        case 'compact':
            return summary ?? 'Conversation compacted'
        case 'microcompact':
            return summary ?? 'Context compacted'
        case 'turn-duration':
            return summary ?? 'Turn duration updated'
        case 'api-error':
            return summary ?? 'API error'
        case 'token-count':
            return summary ?? 'Token count updated'
        case 'plan-updated':
            return summary ?? 'Plan updated'
        default:
            return summary ?? safeStringify(payload)
    }
}

function getSubagentId(payload: Record<string, unknown>): string | null {
    return getString(payload, 'subagentId', 'childAgentId', 'agentId', 'childSourceSessionId', 'sourceSessionId')
}

function getFallbackPreview(payload: Record<string, unknown>): unknown {
    return getUnknown(payload, 'preview', 'rawPayloadPreview', 'rawPreview', 'rawPayload', 'raw', 'payload') ?? payload
}

function sortBlocks<T extends CanonicalBlock>(blocks: readonly T[]): T[] {
    return [...blocks].sort((left, right) => {
        if (left.timelineSeq !== right.timelineSeq) return left.timelineSeq - right.timelineSeq
        if (left.siblingSeq !== right.siblingSeq) return left.siblingSeq - right.siblingSeq
        if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
        return left.id.localeCompare(right.id)
    })
}

function toCommon(block: CanonicalBlock): Omit<CanonicalRenderBlockBase, 'kind' | 'children'> {
    return {
        renderSource: 'canonical',
        id: block.id,
        createdAt: block.createdAt,
        updatedAt: block.updatedAt,
        timelineSeq: block.timelineSeq,
        siblingSeq: block.siblingSeq,
        state: block.state,
        generation: block.generation,
        parserVersion: block.parserVersion,
        sourceRawEventIds: [...block.sourceRawEventIds],
        payload: getPayloadRecord(block)
    }
}

function canonicalBlockToRenderBlock(block: CanonicalBlock): CanonicalRenderBlock {
    const common = toCommon(block)
    const children = sortBlocks(block.children).map(canonicalBlockToRenderBlock)
    const payload = common.payload

    switch (block.kind) {
        case 'user-text':
            return {
                ...common,
                kind: 'user-text',
                text: getText(payload),
                attachments: getAttachments(payload),
                children
            }
        case 'agent-text':
            return {
                ...common,
                kind: 'agent-text',
                text: getText(payload),
                children
            }
        case 'reasoning':
            return {
                ...common,
                kind: 'reasoning',
                text: getText(payload),
                children
            }
        case 'event':
            return {
                ...common,
                kind: 'event',
                subtype: getString(payload, 'subtype'),
                text: formatEventText(payload),
                children
            }
        case 'tool-call':
            return {
                ...common,
                kind: 'tool-call',
                tool: toTool(payload, block, 'Tool'),
                children
            }
        case 'tool-result': {
            const tool = toTool(payload, block, 'Tool result')
            const isError = getBoolean(payload, 'isError', 'error')
            return {
                ...common,
                kind: 'tool-result',
                tool: {
                    ...tool,
                    state: isError === true ? 'error' : tool.state === 'pending' || tool.state === 'running' ? 'completed' : tool.state,
                },
                children
            }
        }
        case 'subagent-root':
            return {
                ...common,
                kind: 'subagent-root',
                title: getString(payload, 'title', 'name'),
                description: getString(payload, 'description', 'summary'),
                subagentId: getSubagentId(payload),
                lifecycleState: getString(payload, 'lifecycleState', 'state') ?? block.state,
                children
            }
        case 'fallback-raw':
            return {
                ...common,
                kind: 'fallback-raw',
                provider: getString(payload, 'provider'),
                rawType: getString(payload, 'rawType', 'raw_type'),
                summary: getString(payload, 'summary', 'text', 'message'),
                preview: getFallbackPreview(payload),
                children
            }
    }
}

export function canonicalRootsToRenderBlocks(roots: readonly CanonicalRootBlock[]): CanonicalRenderBlock[] {
    return sortBlocks(roots).map(canonicalBlockToRenderBlock)
}

export function isCanonicalRenderBlock(value: unknown): value is CanonicalRenderBlock {
    return isObject(value)
        && value.renderSource === 'canonical'
        && typeof value.kind === 'string'
        && Array.isArray(value.sourceRawEventIds)
        && Array.isArray(value.children)
}

export function isCanonicalToolArtifact(value: unknown): value is CanonicalToolArtifact {
    return isCanonicalRenderBlock(value)
        && (value.kind === 'tool-call'
            || value.kind === 'tool-result'
            || value.kind === 'subagent-root'
            || value.kind === 'fallback-raw')
}
