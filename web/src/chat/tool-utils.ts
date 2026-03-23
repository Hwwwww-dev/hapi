import type { NormalizedAgentContent, ToolResultPermission } from '@/chat/types'
import { asNumber, asString, isObject } from '@hapi/protocol'

/**
 * Parse and validate a raw tool_result permissions object into a normalized ToolResultPermission.
 * Shared between agent and user message normalization.
 */
export function normalizeToolResultPermissions(value: unknown): ToolResultPermission | undefined {
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

/**
 * Parse a single tool_use / tool_call content block into a NormalizedAgentContent.
 * Returns null if the block is not a valid tool_use/tool_call.
 */
export function parseToolUseBlock(
    block: Record<string, unknown>,
    uuid: string,
    parentUUID: string | null
): NormalizedAgentContent | null {
    if ((block.type !== 'tool_use' && block.type !== 'tool_call') || typeof block.id !== 'string') {
        return null
    }
    const name = asString(block.name) ?? 'Tool'
    const input = 'input' in block ? block.input : undefined
    const description = isObject(input) && typeof input.description === 'string' ? input.description : null
    return { type: 'tool-call', id: block.id, name, input, description, uuid, parentUUID }
}

/**
 * Parse a single tool_result content block into a NormalizedAgentContent.
 * Returns null if the block is not a valid tool_result.
 */
export function parseToolResultBlock(
    block: Record<string, unknown>,
    uuid: string,
    parentUUID: string | null
): NormalizedAgentContent | null {
    if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
        return null
    }
    return {
        type: 'tool-result',
        tool_use_id: block.tool_use_id,
        content: 'content' in block ? block.content : undefined,
        is_error: Boolean(block.is_error),
        uuid,
        parentUUID,
        permissions: normalizeToolResultPermissions(block.permissions)
    }
}
