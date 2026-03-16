import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type { SessionFileScanEntry } from '@/modules/common/session/BaseSessionScanner'
import type { CodexSessionEvent } from './codexEventConverter'

export type CodexNativeEventEntry = SessionFileScanEntry<CodexSessionEvent> & {
    kind: 'event'
    lineIndex: number
    sourceKey: string
    createdAt: number
}

export type CodexNativeEventIngestErrorEntry = {
    kind: 'ingest-error'
    lineIndex: number
    sourceKey: string
    createdAt: number
    rawType: 'ingest-error'
    rawLine: string
    stage: 'json-parse' | 'schema-parse'
    error: string
}

export type CodexNativeEventRow = CodexNativeEventEntry | CodexNativeEventIngestErrorEntry

export type CodexNativeEventReadResult = {
    entries: CodexNativeEventEntry[]
    rows: CodexNativeEventRow[]
    totalLines: number
    resetToStart: boolean
    sessionId: string | null
    cwd: string | null
    sessionTimestamp: number | null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null
    }
    return value as Record<string, unknown>
}

export function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

export function parseCodexTimestamp(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }
    if (typeof value === 'string' && value.length > 0) {
        const parsed = Date.parse(value)
        return Number.isNaN(parsed) ? null : parsed
    }
    return null
}

export function normalizeCodexPath(value: string): string {
    const resolved = resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isCodexSessionEvent(value: unknown): value is CodexSessionEvent {
    return asString(asRecord(value)?.type) !== null
}

function buildSourceKey(filePath: string, lineIndex: number, sourceRoot?: string): string {
    if (!sourceRoot) {
        return `line:${lineIndex}`
    }

    const relativePath = relative(sourceRoot, filePath).split(sep).filter(Boolean).join('/')
    return `file:${relativePath}:line:${lineIndex}`
}

export async function readCodexNativeEventFile(
    filePath: string,
    startLine: number,
    sourceRoot?: string
): Promise<CodexNativeEventReadResult> {
    let content: string
    try {
        content = await readFile(filePath, 'utf-8')
    } catch {
        return {
            entries: [],
            rows: [],
            totalLines: startLine,
            resetToStart: false,
            sessionId: null,
            cwd: null,
            sessionTimestamp: null
        }
    }

    const lines = content.split('\n')
    const hasTrailingEmpty = lines.length > 0 && lines[lines.length - 1] === ''
    const totalLines = hasTrailingEmpty ? lines.length - 1 : lines.length
    const resetToStart = startLine > totalLines
    const effectiveStartLine = resetToStart ? 0 : startLine

    let sessionId: string | null = null
    let cwd: string | null = null
    let sessionTimestamp: number | null = null
    let lastCreatedAt = 0
    const entries: CodexNativeEventEntry[] = []
    const rows: CodexNativeEventRow[] = []

    for (let index = 0; index < lines.length; index += 1) {
        const trimmed = lines[index].trim()
        if (!trimmed) {
            continue
        }

        const sourceKey = buildSourceKey(filePath, index, sourceRoot)
        const shouldIncludeRow = index >= effectiveStartLine

        try {
            const parsedValue = JSON.parse(trimmed)
            if (!isCodexSessionEvent(parsedValue)) {
                const createdAt = parseCodexTimestamp(asRecord(parsedValue)?.timestamp ?? null)
                    ?? lastCreatedAt
                    ?? sessionTimestamp
                    ?? 0
                lastCreatedAt = createdAt

                if (shouldIncludeRow) {
                    rows.push({
                        kind: 'ingest-error',
                        lineIndex: index,
                        sourceKey,
                        createdAt,
                        rawType: 'ingest-error',
                        rawLine: trimmed,
                        stage: 'schema-parse',
                        error: 'Codex row must include a non-empty string type'
                    })
                }
                continue
            }

            const parsed = parsedValue
            const payload = asRecord(parsed.payload)
            const topLevelTimestamp = parseCodexTimestamp(asRecord(parsed)?.timestamp ?? null)

            if (parsed.type === 'session_meta') {
                const nextSessionId = payload ? asString(payload.id) : null
                const nextCwd = payload ? asString(payload.cwd) : null
                const nextTimestamp = (payload ? parseCodexTimestamp(payload.timestamp) : null) ?? topLevelTimestamp

                if (nextSessionId) {
                    sessionId = nextSessionId
                }
                if (nextCwd) {
                    cwd = normalizeCodexPath(nextCwd)
                }
                if (nextTimestamp !== null) {
                    sessionTimestamp = nextTimestamp
                    lastCreatedAt = nextTimestamp
                }
            }

            if (index < effectiveStartLine) {
                continue
            }

            const createdAt = (payload ? parseCodexTimestamp(payload.timestamp) : null)
                ?? topLevelTimestamp
                ?? lastCreatedAt
                ?? sessionTimestamp
                ?? 0
            lastCreatedAt = createdAt

            const entry: CodexNativeEventEntry = {
                kind: 'event',
                event: parsed,
                lineIndex: index,
                sourceKey,
                createdAt
            }

            entries.push(entry)
            rows.push(entry)
        } catch {
            const createdAt = lastCreatedAt ?? sessionTimestamp ?? 0
            lastCreatedAt = createdAt

            if (!shouldIncludeRow) {
                continue
            }

            rows.push({
                kind: 'ingest-error',
                lineIndex: index,
                sourceKey,
                createdAt,
                rawType: 'ingest-error',
                rawLine: trimmed,
                stage: 'json-parse',
                error: 'Failed to parse JSON'
            })
            continue
        }
    }

    return {
        entries,
        rows,
        totalLines,
        resetToStart,
        sessionId,
        cwd,
        sessionTimestamp
    }
}
