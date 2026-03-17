import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type { SessionFileScanEntry } from '@/modules/common/session/BaseSessionScanner'
import type { CodexSessionEvent } from './codexEventConverter'

export type CodexNativeEventEntry = SessionFileScanEntry<CodexSessionEvent> & {
    sourceKey: string
    createdAt: number
}

export type CodexNativeEventReadResult = {
    entries: CodexNativeEventEntry[]
    totalLines: number
    resetToStart: boolean
    sessionId: string | null
    cwd: string | null
    sessionTimestamp: number | null
    parentSessionId: string | null
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
            totalLines: startLine,
            resetToStart: false,
            sessionId: null,
            cwd: null,
            sessionTimestamp: null,
            parentSessionId: null
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
    let parentSessionId: string | null = null
    let lastCreatedAt = 0
    const entries: CodexNativeEventEntry[] = []

    for (let index = 0; index < lines.length; index += 1) {
        const trimmed = lines[index].trim()
        if (!trimmed) {
            continue
        }

        try {
            const parsed = JSON.parse(trimmed) as CodexSessionEvent
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
                // Extract parent_thread_id from subagent source
                if (!parentSessionId && payload) {
                    const source = asRecord(payload.source)
                    const subagent = source ? asRecord(source.subagent) : null
                    const threadSpawn = subagent ? asRecord(subagent.thread_spawn) : null
                    const parentId = threadSpawn ? asString(threadSpawn.parent_thread_id) : null
                    if (parentId) {
                        parentSessionId = parentId
                    }
                }
            }

            if (index < effectiveStartLine) {
                continue
            }

            const createdAt = (payload ? parseCodexTimestamp(payload.timestamp) : null)
                ?? topLevelTimestamp
                ?? (lastCreatedAt || sessionTimestamp || index)
            lastCreatedAt = createdAt

            entries.push({
                event: parsed,
                lineIndex: index,
                sourceKey: buildSourceKey(filePath, index, sourceRoot),
                createdAt
            })
        } catch {
            continue
        }
    }

    return {
        entries,
        totalLines,
        resetToStart,
        sessionId,
        cwd,
        sessionTimestamp,
        parentSessionId
    }
}
