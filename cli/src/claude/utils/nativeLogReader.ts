import { readFile } from 'node:fs/promises'

import { logger } from '@/ui/logger'
import type { SessionFileScanEntry } from '@/modules/common/session/BaseSessionScanner'
import { RawJSONLines, RawJSONLinesSchema } from '../types'

const INTERNAL_CLAUDE_EVENT_TYPES = new Set([
    'file-history-snapshot',
    'change',
    'queue-operation'
])

export type ClaudeNativeLogEntry = SessionFileScanEntry<RawJSONLines> & {
    sourceKey: string
    sessionId: string | null
    cwd: string | null
    createdAt: number
}

function parseTimestamp(value: string | undefined): number | null {
    if (!value) {
        return null
    }

    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
}

function getSessionId(message: RawJSONLines): string | null {
    if ('sessionId' in message && typeof message.sessionId === 'string') {
        return message.sessionId
    }

    if ('session_id' in message && typeof message.session_id === 'string') {
        return message.session_id
    }

    return null
}

export async function readClaudeNativeLog(
    filePath: string,
    startLine: number
): Promise<{ entries: ClaudeNativeLogEntry[]; totalLines: number }> {
    logger.debug(`[CLAUDE_NATIVE_LOG] Reading session file: ${filePath}`)

    let file: string
    try {
        file = await readFile(filePath, 'utf-8')
    } catch {
        logger.debug(`[CLAUDE_NATIVE_LOG] Session file not found: ${filePath}`)
        return { entries: [], totalLines: startLine }
    }

    const lines = file.split('\n')
    const hasTrailingEmpty = lines.length > 0 && lines[lines.length - 1] === ''
    const totalLines = hasTrailingEmpty ? lines.length - 1 : lines.length
    const effectiveStartLine = startLine > totalLines ? 0 : startLine

    const parsedEntries: Array<{
        event: RawJSONLines
        lineIndex: number
        sessionId: string | null
        cwd: string | null
        createdAt: number | null
    }> = []

    for (let index = effectiveStartLine; index < lines.length; index += 1) {
        const line = lines[index]
        if (line.trim() === '') {
            continue
        }

        try {
            const message = JSON.parse(line)
            if (message.type && INTERNAL_CLAUDE_EVENT_TYPES.has(message.type)) {
                continue
            }

            const parsed = RawJSONLinesSchema.safeParse(message)
            if (!parsed.success) {
                continue
            }

            parsedEntries.push({
                event: parsed.data,
                lineIndex: index,
                sessionId: getSessionId(parsed.data),
                cwd: typeof parsed.data.cwd === 'string' ? parsed.data.cwd : null,
                createdAt: parseTimestamp(parsed.data.timestamp)
            })
        } catch (error) {
            logger.debug(`[CLAUDE_NATIVE_LOG] Error processing message: ${error}`)
        }
    }

    const fallbackSessionId = parsedEntries.find((entry) => entry.sessionId)?.sessionId ?? null
    const fallbackCwd = parsedEntries.find((entry) => entry.cwd)?.cwd ?? null
    let lastCreatedAt = 0

    const entries = parsedEntries.map((entry) => {
        const createdAt = entry.createdAt ?? (lastCreatedAt || entry.lineIndex)
        lastCreatedAt = createdAt

        return {
            event: entry.event,
            lineIndex: entry.lineIndex,
            sourceKey: `line:${entry.lineIndex}`,
            sessionId: entry.sessionId ?? fallbackSessionId,
            cwd: entry.cwd ?? fallbackCwd,
            createdAt
        }
    })

    return { entries, totalLines }
}
