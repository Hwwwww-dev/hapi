import { safeStringify } from '@hapi/protocol'
import { canonicalRootsToRenderBlocks, type CanonicalRenderBlock } from '@/chat/canonical'
import { getExplicitSessionTitle, getSessionPathFallbackTitle, type CanonicalRootBlock, type Session } from '@/types/api'
import { canonicalizeToolName } from '@/lib/toolNames'
import { VOICE_CONFIG } from '../voiceConfig'

interface SessionMetadata {
    summary?: { text?: string }
    path?: string
    machineId?: string
    homeDir?: string
}

type CanonicalVoiceInput = CanonicalRootBlock | CanonicalRenderBlock

function isRenderBlock(value: CanonicalVoiceInput): value is CanonicalRenderBlock {
    return (value as { renderSource?: unknown }).renderSource === 'canonical'
}

function toRenderBlock(message: CanonicalVoiceInput): CanonicalRenderBlock | null {
    if (isRenderBlock(message)) {
        return message
    }
    return canonicalRootsToRenderBlocks([message])[0] ?? null
}

function toRenderBlocks(messages: readonly CanonicalVoiceInput[]): CanonicalRenderBlock[] {
    if (messages.length === 0) {
        return []
    }

    if (messages.every(isRenderBlock)) {
        return [...messages]
    }

    return canonicalRootsToRenderBlocks(messages as readonly CanonicalRootBlock[])
}

function formatPlainText(role: 'assistant' | 'user', text: string): string {
    if (role === 'assistant') {
        return `Claude Code: \n<text>${text}</text>`
    }
    return `User sent message: \n<text>${text}</text>`
}

function formatToolUpdate(block: Extract<CanonicalRenderBlock, { kind: 'tool-call' | 'tool-result' }>): string | null {
    if (VOICE_CONFIG.DISABLE_TOOL_CALLS) {
        return null
    }

    const name = canonicalizeToolName(block.tool.name || 'unknown')
    if (VOICE_CONFIG.LIMITED_TOOL_CALLS) {
        if (block.kind === 'tool-result') {
            return `Claude Code completed ${name}`
        }
        return `Claude Code is using ${name}`
    }

    if (block.kind === 'tool-result') {
        return `Claude Code completed ${name} with result: <result>${safeStringify(block.tool.result)}</result>`
    }

    return `Claude Code is using ${name} with arguments: <arguments>${safeStringify(block.tool.input)}</arguments>`
}

function formatFallbackRaw(block: Extract<CanonicalRenderBlock, { kind: 'fallback-raw' }>): string {
    const provider = block.provider ?? 'unknown-provider'
    const rawType = block.rawType ?? 'unknown-raw-type'
    const summary = block.summary ?? safeStringify(block.preview)
    return `Claude Code emitted unsupported ${provider}/${rawType}: <details>${summary}</details>`
}

function formatSubagentHeader(block: Extract<CanonicalRenderBlock, { kind: 'subagent-root' }>): string {
    const title = block.title ?? block.description ?? 'Subagent'
    return `Claude Code started subagent: <subagent>${title}</subagent>`
}

function formatRenderBlock(block: CanonicalRenderBlock): string[] {
    const childLines = block.children.flatMap(formatRenderBlock)

    switch (block.kind) {
        case 'user-text':
            return [formatPlainText('user', block.text), ...childLines]
        case 'agent-text':
            return [formatPlainText('assistant', block.text), ...childLines]
        case 'reasoning':
        case 'event':
            return childLines
        case 'tool-call':
        case 'tool-result': {
            const toolLine = formatToolUpdate(block)
            return toolLine ? [toolLine, ...childLines] : childLines
        }
        case 'subagent-root':
            return [formatSubagentHeader(block), ...childLines]
        case 'fallback-raw':
            return [formatFallbackRaw(block), ...childLines]
    }
}

function compareRenderBlocks(left: CanonicalRenderBlock, right: CanonicalRenderBlock): number {
    if (left.timelineSeq !== right.timelineSeq) {
        return left.timelineSeq - right.timelineSeq
    }
    if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt
    }
    return left.id.localeCompare(right.id)
}

/**
 * Format a permission request for natural language context
 */
export function formatPermissionRequest(
    sessionId: string,
    requestId: string,
    toolName: string,
    toolArgs: unknown
): string {
    const displayToolName = canonicalizeToolName(toolName)
    return `Claude Code is requesting permission to use ${displayToolName} (session ${sessionId}):
<request_id>${requestId}</request_id>
<tool_name>${displayToolName}</tool_name>
<tool_args>${JSON.stringify(toolArgs)}</tool_args>`
}

/**
 * Format a single canonical message or render block for voice context
 */
export function formatMessage(message: CanonicalVoiceInput): string | null {
    const renderBlock = toRenderBlock(message)
    if (!renderBlock) {
        return null
    }

    const lines = formatRenderBlock(renderBlock)
    return lines.length > 0 ? lines.join('\n\n') : null
}

export function formatNewSingleMessage(sessionId: string, message: CanonicalVoiceInput): string | null {
    const formatted = formatMessage(message)
    if (!formatted) {
        return null
    }
    return 'New message in session: ' + sessionId + '\n\n' + formatted
}

export function formatNewMessages(sessionId: string, messages: CanonicalVoiceInput[]): string | null {
    const formatted = toRenderBlocks(messages)
        .sort(compareRenderBlocks)
        .map(formatMessage)
        .filter((entry): entry is string => Boolean(entry))
    if (formatted.length === 0) {
        return null
    }
    return 'New messages in session: ' + sessionId + '\n\n' + formatted.join('\n\n')
}

export function formatHistory(sessionId: string, messages: CanonicalVoiceInput[]): string {
    const renderBlocks = toRenderBlocks(messages)
    const messagesToFormat = VOICE_CONFIG.MAX_HISTORY_MESSAGES > 0
        ? renderBlocks.slice(-VOICE_CONFIG.MAX_HISTORY_MESSAGES)
        : renderBlocks
    const formatted = messagesToFormat.map(formatMessage).filter((entry): entry is string => Boolean(entry))
    return 'History of messages in session: ' + sessionId + '\n\n' + formatted.join('\n\n')
}

export function formatSessionFull(session: Session | null, messages: CanonicalVoiceInput[]): string {
    if (!session) {
        return 'Session not available'
    }

    const sessionName = getExplicitSessionTitle(session) ?? getSessionPathFallbackTitle(session)
    const sessionPath = session.metadata?.path
    const lines: string[] = []

    lines.push(`# Session ID: ${session.id}`)
    lines.push(`# Project path: ${sessionPath}`)
    lines.push(`# Session summary:\n${sessionName}`)

    if (session.metadata?.summary?.text) {
        lines.push('## Session Summary')
        lines.push(session.metadata.summary.text)
        lines.push('')
    }

    lines.push('## Our interaction history so far')
    lines.push('')
    lines.push(formatHistory(session.id, messages))

    return lines.join('\n\n')
}

export function formatSessionOffline(sessionId: string, _metadata?: SessionMetadata): string {
    return `Session went offline: ${sessionId}`
}

export function formatSessionOnline(sessionId: string, _metadata?: SessionMetadata): string {
    return `Session came online: ${sessionId}`
}

export function formatSessionFocus(sessionId: string, _metadata?: SessionMetadata): string {
    return `Session became focused: ${sessionId}`
}

export function formatReadyEvent(sessionId: string): string {
    return `Claude Code done working in session: ${sessionId}. The previous message(s) are the summary of the work done. Report this to the human immediately.`
}
