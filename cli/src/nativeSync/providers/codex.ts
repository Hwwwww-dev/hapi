import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import type { CodexSessionEvent } from '@/codex/utils/codexEventConverter'
import { convertCodexEvent } from '@/codex/utils/codexEventConverter'
import { readCodexNativeEventFile } from '@/codex/utils/nativeEventReader'
import type { NativeMessageBatch, NativeSyncProvider } from './provider'
import type { NativeSessionSummary, NativeSyncState } from '../types'

type CodexCursor = {
    filePath: string
    line: number
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
        return Number.isInteger(parsed.line) && parsed.line >= 0 ? parsed.line : 0
    } catch {
        return 0
    }
}

function buildCursor(filePath: string, line: number): string {
    return JSON.stringify({ filePath, line })
}

function convertNativeCodexEvent(event: CodexSessionEvent): unknown | null {
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
        return {
            role: 'agent',
            content: {
                type: 'codex',
                data: converted.message
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
    return {
        name: 'codex',
        async discoverSessions(): Promise<NativeSessionSummary[]> {
            const sessionsRoot = getSessionsRoot()
            const files = await listSessionFiles(sessionsRoot)
            const summaries: NativeSessionSummary[] = []

            for (const filePath of files) {
                const result = await readCodexNativeEventFile(filePath, 0, sessionsRoot)
                if (!result.sessionId || !result.cwd) {
                    continue
                }

                const fileStat = await stat(filePath)
                const lastEntry = [...result.entries].reverse().find((entry) => entry.event.type !== 'session_meta')
                summaries.push({
                    provider: 'codex',
                    nativeSessionId: result.sessionId,
                    projectPath: result.cwd,
                    displayPath: result.cwd,
                    flavor: 'codex',
                    discoveredAt: Math.floor(fileStat.birthtimeMs || fileStat.mtimeMs),
                    lastActivityAt: lastEntry?.createdAt ?? result.sessionTimestamp ?? Math.floor(fileStat.mtimeMs),
                    title: extractTitle(result)
                })
            }

            return summaries.sort((left, right) => right.lastActivityAt - left.lastActivityAt)
        },

        async readMessages(summary: NativeSessionSummary, state: NativeSyncState | null): Promise<NativeMessageBatch> {
            const sessionsRoot = getSessionsRoot()
            const filePath = state?.filePath ?? await resolveSessionFile(summary.nativeSessionId)
            if (!filePath) {
                return {
                    messages: [],
                    cursor: state?.cursor ?? null,
                    filePath: state?.filePath ?? null,
                    mtime: state?.mtime ?? null
                }
            }

            const startLine = parseCursor(state?.cursor, filePath)
            const result = await readCodexNativeEventFile(filePath, startLine, sessionsRoot)
            const fileStat = await stat(filePath)

            return {
                messages: result.entries.flatMap((entry) => {
                    if (entry.event.type === 'session_meta') {
                        return []
                    }

                    const content = convertNativeCodexEvent(entry.event)
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
                mtime: Math.floor(fileStat.mtimeMs)
            }
        }
    }
}
