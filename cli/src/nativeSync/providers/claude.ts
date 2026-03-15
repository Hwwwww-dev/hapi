import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'

import { readClaudeNativeLog } from '@/claude/utils/nativeLogReader'
import { getProjectPath } from '@/claude/utils/path'
import type { NativeMessageBatch, NativeSyncProvider } from './provider'
import type { NativeSessionSummary, NativeSyncState } from '../types'

type ClaudeCursor = {
    filePath: string
    line: number
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
    return {
        name: 'claude',
        async discoverSessions(): Promise<NativeSessionSummary[]> {
            const sessionFiles = await listSessionFiles()
            const summaries: NativeSessionSummary[] = []

            for (const filePath of sessionFiles) {
                const { entries } = await readClaudeNativeLog(filePath, 0)
                const firstEntryWithCwd = entries.find((entry) => entry.cwd)
                if (!firstEntryWithCwd?.cwd) {
                    continue
                }

                const fileStat = await stat(filePath)
                const lastEntry = entries[entries.length - 1]
                summaries.push({
                    provider: 'claude',
                    nativeSessionId: basename(filePath, '.jsonl'),
                    projectPath: firstEntryWithCwd.cwd,
                    displayPath: firstEntryWithCwd.cwd,
                    flavor: 'claude',
                    discoveredAt: Math.floor(fileStat.birthtimeMs || fileStat.mtimeMs),
                    lastActivityAt: lastEntry?.createdAt ?? Math.floor(fileStat.mtimeMs),
                    title: extractTitle(entries.find((entry) => entry.event.type === 'user')?.event)
                })
            }

            return summaries.sort((left, right) => right.lastActivityAt - left.lastActivityAt)
        },

        async readMessages(summary: NativeSessionSummary, state: NativeSyncState | null): Promise<NativeMessageBatch> {
            const filePath = state?.filePath ?? join(getProjectPath(summary.projectPath), `${summary.nativeSessionId}.jsonl`)
            const startLine = parseCursor(state?.cursor, filePath)
            const { entries, totalLines } = await readClaudeNativeLog(filePath, startLine)
            const fileStat = await stat(filePath)

            return {
                messages: entries.map((entry) => ({
                    sourceKey: entry.sourceKey,
                    createdAt: entry.createdAt,
                    content: entry.event
                })),
                cursor: buildCursor(filePath, totalLines),
                filePath,
                mtime: Math.floor(fileStat.mtimeMs)
            }
        }
    }
}
