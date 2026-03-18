import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'

import { readClaudeNativeLog } from '@/claude/utils/nativeLogReader'
import { getProjectPath } from '@/claude/utils/path'
import type { NativeMessageBatch, NativeSyncProvider } from './provider'
import { HAPI_METADATA_PROBE_MARKER } from '../constants'
import type { NativeSessionSummary, NativeSyncState } from '../types'

type ClaudeCursor = {
    filePath: string
    line: number
}

type CachedSummaryEntry = {
    mtimeMs: number
    summary: NativeSessionSummary | null
}

function toTimestampMs(value: number | bigint): number {
    return typeof value === 'bigint' ? Number(value) : value
}

function parseClaudeEventTimestamp(value: string | undefined): number | null {
    if (!value) {
        return null
    }

    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
}

function resolveClaudeSummaryTimes(
    entries: Awaited<ReturnType<typeof readClaudeNativeLog>>['entries'],
    fileStat: Awaited<ReturnType<typeof stat>>
): Pick<NativeSessionSummary, 'createdAt' | 'discoveredAt' | 'lastActivityAt'> {
    const eventTimestamps = entries
        .map((entry) => parseClaudeEventTimestamp(entry.event.timestamp))
        .filter((timestamp): timestamp is number => timestamp !== null)
    const createdAt = eventTimestamps[0] ?? Math.floor(toTimestampMs(fileStat.birthtimeMs || fileStat.mtimeMs))
    const lastActivityAt = Math.max(eventTimestamps.at(-1) ?? Math.floor(toTimestampMs(fileStat.mtimeMs)), createdAt)

    return {
        createdAt,
        discoveredAt: createdAt,
        lastActivityAt
    }
}

function getClaudeConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

function getProjectsDir(): string {
    return join(getClaudeConfigDir(), 'projects')
}

function extractTitle(summary: Awaited<ReturnType<typeof readClaudeNativeLog>>['entries'][number]['event'] | undefined): string | undefined {
    if (!summary || summary.type !== 'user') {
        return undefined
    }

    const raw = summary.message.content
    if (typeof raw === 'string') {
        return raw.trim() || undefined
    }

    if (Array.isArray(raw)) {
        const firstText = raw.find((item) => item && typeof item === 'object' && 'text' in item && typeof item.text === 'string')
        if (firstText && typeof firstText.text === 'string') {
            return firstText.text.trim() || undefined
        }
    }

    return undefined
}

function parseCursor(cursor: string | null | undefined, filePath: string): number {
    if (!cursor) {
        return 0
    }

    try {
        const parsed = JSON.parse(cursor) as ClaudeCursor
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

async function listSessionFiles(): Promise<string[]> {
    const projectsDir = getProjectsDir()
    if (!existsSync(projectsDir)) {
        return []
    }

    const projectDirs = await readdir(projectsDir, { withFileTypes: true })
    const files: string[] = []

    for (const projectDir of projectDirs) {
        if (!projectDir.isDirectory()) {
            continue
        }

        const projectPath = join(projectsDir, projectDir.name)
        const projectFiles = await readdir(projectPath, { withFileTypes: true })
        for (const file of projectFiles) {
            if (!file.isFile() || !file.name.endsWith('.jsonl')) {
                continue
            }
            files.push(join(projectPath, file.name))
        }
    }

    return files
}

export function createClaudeNativeProvider(): NativeSyncProvider {
    const summaryCache = new Map<string, CachedSummaryEntry>()
    const sessionFileCache = new Map<string, string>()

    return {
        name: 'claude',
        async discoverSessions(): Promise<NativeSessionSummary[]> {
            const sessionFiles = await listSessionFiles()
            const summaries: NativeSessionSummary[] = []
            const activeFiles = new Set(sessionFiles)

            for (const filePath of summaryCache.keys()) {
                if (!activeFiles.has(filePath)) {
                    const cached = summaryCache.get(filePath)
                    if (cached?.summary) {
                        sessionFileCache.delete(cached.summary.nativeSessionId)
                    }
                    summaryCache.delete(filePath)
                }
            }

            for (const filePath of sessionFiles) {
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

                const { entries } = await readClaudeNativeLog(filePath, 0)
                const firstEntryWithCwd = entries.find((entry) => entry.cwd)
                if (!firstEntryWithCwd?.cwd) {
                    summaryCache.set(filePath, { mtimeMs, summary: null })
                    continue
                }

                const { createdAt, discoveredAt, lastActivityAt } = resolveClaudeSummaryTimes(entries, fileStat)
                const title = extractTitle(entries.find((entry) => entry.event.type === 'user')?.event)

                // Skip internal metadata probe sessions created by hapi (current marker and legacy 'hello' prompt)
                if (title === HAPI_METADATA_PROBE_MARKER || title === 'hello') {
                    summaryCache.set(filePath, { mtimeMs, summary: null })
                    continue
                }

                const summary: NativeSessionSummary = {
                    provider: 'claude',
                    nativeSessionId: basename(filePath, '.jsonl'),
                    projectPath: firstEntryWithCwd.cwd,
                    displayPath: firstEntryWithCwd.cwd,
                    flavor: 'claude',
                    createdAt,
                    discoveredAt,
                    lastActivityAt,
                    title
                }
                summaryCache.set(filePath, { mtimeMs, summary })
                sessionFileCache.set(summary.nativeSessionId, filePath)
                summaries.push(summary)
            }

            return summaries.sort((left, right) => right.lastActivityAt - left.lastActivityAt)
        },

        async readMessages(summary: NativeSessionSummary, state: NativeSyncState | null): Promise<NativeMessageBatch> {
            const filePath = state?.filePath
                ?? sessionFileCache.get(summary.nativeSessionId)
                ?? join(getProjectPath(summary.projectPath), `${summary.nativeSessionId}.jsonl`)
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
            const { entries, totalLines } = await readClaudeNativeLog(filePath, startLine)
            sessionFileCache.set(summary.nativeSessionId, filePath)

            return {
                messages: entries.map((entry) => ({
                    sourceKey: entry.sourceKey,
                    createdAt: entry.createdAt,
                    content: entry.event
                })),
                cursor: buildCursor(filePath, totalLines),
                filePath,
                mtime: mtimeMs
            }
        }
    }
}
