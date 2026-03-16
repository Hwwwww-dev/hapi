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
    kind: 'event'
    lineIndex: number
    sourceKey: string
    sessionId: string | null
    cwd: string | null
    createdAt: number
}

export type ClaudeNativeLogIngestErrorEntry = {
    kind: 'ingest-error'
    lineIndex: number
    sourceKey: string
    sessionId: string | null
    cwd: string | null
    createdAt: number
    rawType: 'ingest-error'
    rawLine: string
    stage: 'json-parse' | 'schema-parse'
    error: string
}

export type ClaudeNativeLogRow = ClaudeNativeLogEntry | ClaudeNativeLogIngestErrorEntry

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

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null
    }

    return value as Record<string, unknown>
}

function getRawString(record: Record<string, unknown> | null, key: string): string | null {
    const value = record?.[key]
    return typeof value === 'string' ? value : null
}

export async function readClaudeNativeLog(
    filePath: string,
    startLine: number
): Promise<{ entries: ClaudeNativeLogEntry[]; rows: ClaudeNativeLogRow[]; totalLines: number }> {
    logger.debug(`[CLAUDE_NATIVE_LOG] Reading session file: ${filePath}`)

    let file: string
    try {
        file = await readFile(filePath, 'utf-8')
    } catch {
        logger.debug(`[CLAUDE_NATIVE_LOG] Session file not found: ${filePath}`)
        return { entries: [], rows: [], totalLines: startLine }
    }

    const lines = file.split('\n')
    const hasTrailingEmpty = lines.length > 0 && lines[lines.length - 1] === ''
    const totalLines = hasTrailingEmpty ? lines.length - 1 : lines.length
    const effectiveStartLine = startLine > totalLines ? 0 : startLine

    const entries: ClaudeNativeLogEntry[] = []
    const rows: ClaudeNativeLogRow[] = []
    let fallbackSessionId: string | null = null
    let fallbackCwd: string | null = null
    let lastCreatedAt = 0

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (line.trim() === '') {
            continue
        }

        const sourceKey = `line:${index}`
        const shouldIncludeRow = index >= effectiveStartLine

        try {
            const message = JSON.parse(line)
            if (message.type && INTERNAL_CLAUDE_EVENT_TYPES.has(message.type)) {
                continue
            }

            const parsed = RawJSONLinesSchema.safeParse(message)
            if (!parsed.success) {
                const rawRecord = asRecord(message)
                const createdAt = parseTimestamp(getRawString(rawRecord, 'timestamp') ?? undefined) ?? lastCreatedAt
                const sessionId: string | null = getRawString(rawRecord, 'sessionId') ?? getRawString(rawRecord, 'session_id') ?? fallbackSessionId
                const cwd: string | null = getRawString(rawRecord, 'cwd') ?? fallbackCwd

                lastCreatedAt = createdAt
                fallbackSessionId = sessionId
                fallbackCwd = cwd

                if (shouldIncludeRow) {
                    rows.push({
                        kind: 'ingest-error',
                        lineIndex: index,
                        sourceKey,
                        sessionId,
                        cwd,
                        createdAt,
                        rawType: 'ingest-error',
                        rawLine: line,
                        stage: 'schema-parse',
                        error: parsed.error.message
                    })
                }
                continue
            }

            const sessionId: string | null = getSessionId(parsed.data) ?? fallbackSessionId
            const cwd: string | null = typeof parsed.data.cwd === 'string' ? parsed.data.cwd : fallbackCwd
            const createdAt = parseTimestamp(parsed.data.timestamp) ?? lastCreatedAt

            lastCreatedAt = createdAt
            fallbackSessionId = sessionId
            fallbackCwd = cwd

            const entry: ClaudeNativeLogEntry = {
                kind: 'event',
                event: parsed.data,
                lineIndex: index,
                sourceKey,
                sessionId,
                cwd,
                createdAt
            }

            entries.push(entry)
            if (shouldIncludeRow) {
                rows.push(entry)
            }
        } catch (error) {
            logger.debug(`[CLAUDE_NATIVE_LOG] Error processing message: ${error}`)
            const createdAt = lastCreatedAt
            lastCreatedAt = createdAt
            if (shouldIncludeRow) {
                rows.push({
                    kind: 'ingest-error',
                    lineIndex: index,
                    sourceKey,
                    sessionId: fallbackSessionId,
                    cwd: fallbackCwd,
                    createdAt,
                    rawType: 'ingest-error',
                    rawLine: line,
                    stage: 'json-parse',
                    error: error instanceof Error ? error.message : String(error)
                })
            }
        }
    }

    return { entries, rows, totalLines }
}
