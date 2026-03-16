import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import type { CodexSessionEvent } from '@/codex/utils/codexEventConverter'
import { convertCodexEvent } from '@/codex/utils/codexEventConverter'
import { asRecord, parseCodexTimestamp, readCodexNativeEventFile } from '@/codex/utils/nativeEventReader'
import type { NativeMessageBatch, NativeSyncProvider } from './provider'
import type { NativeSessionSummary, NativeSyncState } from '../types'

type CodexCursor = {
    filePath: string
    line: number
}

const CURSOR_RESCAN_OVERLAP_LINES = 512

type CachedSummaryEntry = {
    mtimeMs: number
    summary: NativeSessionSummary | null
}

function toTimestampMs(value: number | bigint): number {
    return typeof value === 'bigint' ? Number(value) : value
}

function extractCodexEventTimestamp(event: CodexSessionEvent): number | null {
    const payload = asRecord(event.payload)
    return (payload ? parseCodexTimestamp(payload.timestamp) : null)
        ?? parseCodexTimestamp(event.timestamp)
}

function extractSessionMetaPayloadTimestamp(entries: Awaited<ReturnType<typeof readCodexNativeEventFile>>['entries']): number | null {
    for (const entry of entries) {
        if (entry.event.type !== 'session_meta') {
            continue
        }

        const payload = asRecord(entry.event.payload)
        const timestamp = payload ? parseCodexTimestamp(payload.timestamp) : null
        if (timestamp !== null) {
            return timestamp
        }
    }

    return null
}

function resolveCodexSummaryTimes(
    result: Awaited<ReturnType<typeof readCodexNativeEventFile>>,
    fileStat: Awaited<ReturnType<typeof stat>>
): Pick<NativeSessionSummary, 'createdAt' | 'discoveredAt' | 'lastActivityAt'> {
    const sessionMetaPayloadTimestamp = extractSessionMetaPayloadTimestamp(result.entries)
    const firstEventTimestamp = result.entries
        .map((entry) => extractCodexEventTimestamp(entry.event))
        .find((timestamp): timestamp is number => timestamp !== null)
    const lastNonSessionMetaTimestamp = [...result.entries]
        .reverse()
        .map((entry) => entry.event.type === 'session_meta' ? null : extractCodexEventTimestamp(entry.event))
        .find((timestamp): timestamp is number => timestamp !== null)

    const createdAt = sessionMetaPayloadTimestamp
        ?? firstEventTimestamp
        ?? Math.floor(toTimestampMs(fileStat.birthtimeMs || fileStat.mtimeMs))
    const lastActivityAt = Math.max(
        lastNonSessionMetaTimestamp
            ?? sessionMetaPayloadTimestamp
            ?? Math.floor(toTimestampMs(fileStat.mtimeMs)),
        createdAt
    )

    return {
        createdAt,
        discoveredAt: createdAt,
        lastActivityAt
    }
}

function getSessionsRoot(): string {
    const codexHomeDir = process.env.CODEX_HOME || join(homedir(), '.codex')
    return join(codexHomeDir, 'sessions')
}

async function listSessionFiles(dir: string): Promise<string[]> {
    if (!existsSync(dir)) {
        return []
    }

    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...await listSessionFiles(fullPath))
            continue
        }
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            files.push(fullPath)
        }
    }

    return files
}

function parseCursor(cursor: string | null | undefined, filePath: string): number {
    if (!cursor) {
        return 0
    }

    try {
        const parsed = JSON.parse(cursor) as CodexCursor
        if (parsed.filePath !== filePath) {
            return 0
        }
        if (!Number.isInteger(parsed.line) || parsed.line < 0) {
            return 0
        }
        // Keep a small overlap so parser fixes can self-heal recent imported rows
        // without resetting the whole native-sync cursor.
        return Math.max(0, parsed.line - CURSOR_RESCAN_OVERLAP_LINES)
    } catch {
        return 0
    }
}

function buildCursor(filePath: string, line: number): string {
    return JSON.stringify({ filePath, line })
}

function convertNativeCodexEvent(event: CodexSessionEvent, sourceKey: string): unknown | null {
    const converted = convertCodexEvent(event)
    if (!converted) {
        return null
    }

    if (converted.userMessage) {
        return {
            role: 'user',
            content: {
                type: 'text',
                text: converted.userMessage
            },
            meta: {
                sentFrom: 'cli'
            }
        }
    }

    if (converted.message) {
        const message = (() => {
            if (converted.message.type === 'message' || converted.message.type === 'reasoning' || converted.message.type === 'token_count') {
                return {
                    ...converted.message,
                    id: `native:${sourceKey}:${converted.message.type}`
                }
            }
            if (converted.message.type === 'tool-call') {
                return {
                    ...converted.message,
                    id: `native:${sourceKey}:tool-call:${converted.message.callId}`
                }
            }
            if (converted.message.type === 'tool-call-result') {
                return {
                    ...converted.message,
                    id: `native:${sourceKey}:tool-call-result:${converted.message.callId}`
                }
            }
            return converted.message
        })()

        return {
            role: 'agent',
            content: {
                type: 'codex',
                data: message
            },
            meta: {
                sentFrom: 'cli'
            }
        }
    }

    return null
}

function extractTitle(result: Awaited<ReturnType<typeof readCodexNativeEventFile>>): string | undefined {
    for (const entry of result.entries) {
        const converted = convertCodexEvent(entry.event)
        if (!converted?.userMessage) {
            continue
        }

        const title = converted.userMessage.trim()
        if (title) {
            return title
        }
    }

    return undefined
}

async function resolveSessionFile(nativeSessionId: string): Promise<string | null> {
    const sessionsRoot = getSessionsRoot()
    const files = await listSessionFiles(sessionsRoot)
    const suffix = `${nativeSessionId}.jsonl`
    return files.find((filePath) => filePath.endsWith(suffix)) ?? null
}

export function createCodexNativeProvider(): NativeSyncProvider {
    const summaryCache = new Map<string, CachedSummaryEntry>()
    const sessionFileCache = new Map<string, string>()

    return {
        name: 'codex',
        async discoverSessions(): Promise<NativeSessionSummary[]> {
            const sessionsRoot = getSessionsRoot()
            const files = await listSessionFiles(sessionsRoot)
            const summaries: NativeSessionSummary[] = []
            const activeFiles = new Set(files)

            for (const filePath of summaryCache.keys()) {
                if (!activeFiles.has(filePath)) {
                    const cached = summaryCache.get(filePath)
                    if (cached?.summary) {
                        sessionFileCache.delete(cached.summary.nativeSessionId)
                    }
                    summaryCache.delete(filePath)
                }
            }

            for (const filePath of files) {
                const fileStat = await stat(filePath)
                const mtimeMs = Math.floor(fileStat.mtimeMs)
                const cached = summaryCache.get(filePath)
                if (cached && cached.mtimeMs === mtimeMs) {
                    if (cached.summary) {
                        summaries.push(cached.summary)
                        sessionFileCache.set(cached.summary.nativeSessionId, filePath)
                    }
                    continue
                }

                const result = await readCodexNativeEventFile(filePath, 0, sessionsRoot)
                if (!result.sessionId || !result.cwd) {
                    summaryCache.set(filePath, { mtimeMs, summary: null })
                    continue
                }

                const { createdAt, discoveredAt, lastActivityAt } = resolveCodexSummaryTimes(result, fileStat)
                const summary: NativeSessionSummary = {
                    provider: 'codex',
                    nativeSessionId: result.sessionId,
                    projectPath: result.cwd,
                    displayPath: result.cwd,
                    flavor: 'codex',
                    createdAt,
                    discoveredAt,
                    lastActivityAt,
                    title: extractTitle(result)
                }
                summaryCache.set(filePath, { mtimeMs, summary })
                sessionFileCache.set(summary.nativeSessionId, filePath)
                summaries.push(summary)
            }

            return summaries.sort((left, right) => right.lastActivityAt - left.lastActivityAt)
        },

        async readMessages(summary: NativeSessionSummary, state: NativeSyncState | null): Promise<NativeMessageBatch> {
            const sessionsRoot = getSessionsRoot()
            const filePath = state?.filePath
                ?? sessionFileCache.get(summary.nativeSessionId)
                ?? await resolveSessionFile(summary.nativeSessionId)
            if (!filePath) {
                return {
                    messages: [],
                    cursor: state?.cursor ?? null,
                    filePath: state?.filePath ?? null,
                    mtime: state?.mtime ?? null
                }
            }

            sessionFileCache.set(summary.nativeSessionId, filePath)

            const fileStat = await stat(filePath)
            const mtimeMs = Math.floor(fileStat.mtimeMs)
            if (state?.filePath === filePath && state.mtime === mtimeMs) {
                return {
                    messages: [],
                    cursor: state.cursor,
                    filePath,
                    mtime: mtimeMs
                }
            }

            const startLine = parseCursor(state?.cursor, filePath)
            const result = await readCodexNativeEventFile(filePath, startLine, sessionsRoot)

            return {
                messages: result.entries.flatMap((entry) => {
                    if (entry.event.type === 'session_meta') {
                        return []
                    }

                    const content = convertNativeCodexEvent(entry.event, entry.sourceKey)
                    if (!content) {
                        return []
                    }

                    return [{
                        sourceKey: entry.sourceKey,
                        createdAt: entry.createdAt,
                        content
                    }]
                }),
                cursor: buildCursor(filePath, result.totalLines),
                filePath,
                mtime: mtimeMs
            }
        }
    }
}
