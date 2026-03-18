import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFile, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createClaudeNativeProvider } from './claude'
import { getProjectPath } from '@/claude/utils/path'
import { HAPI_METADATA_PROBE_MARKER } from '../constants'

describe('Claude native provider', () => {
    let tempDir: string
    let originalClaudeConfigDir: string | undefined

    beforeEach(async () => {
        tempDir = join(tmpdir(), `claude-native-provider-${Date.now()}`)
        await mkdir(tempDir, { recursive: true })
        originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
        process.env.CLAUDE_CONFIG_DIR = tempDir
    })

    afterEach(async () => {
        if (originalClaudeConfigDir === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR
        } else {
            process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
        }

        if (existsSync(tempDir)) {
            await rm(tempDir, { recursive: true, force: true })
        }
    })

    it('enumerates Claude session files into native session summaries', async () => {
        const fixture = await readFile(join(__dirname, '../../claude/utils/__fixtures__/0-say-lol-session.jsonl'), 'utf-8')
        const sessionId = '93a9705e-bc6a-406d-8dce-8acc014dedbd'
        const projectPath = '/Users/kirilldubovitskiy/projects/happy/handy-cli/notes/test-project'
        const projectDir = getProjectPath(projectPath)

        await mkdir(projectDir, { recursive: true })
        await writeFile(join(projectDir, `${sessionId}.jsonl`), fixture)

        const provider = createClaudeNativeProvider()
        const summaries = await provider.discoverSessions()

        expect(summaries).toHaveLength(1)
        expect(summaries[0]).toEqual(expect.objectContaining({
            provider: 'claude',
            nativeSessionId: sessionId,
            projectPath,
            displayPath: projectPath,
            flavor: 'claude',
            title: 'say lol'
        }))
        expect(summaries[0].lastActivityAt).toBeGreaterThan(0)
    })

    it('skips sessions whose first user message is the hapi metadata probe marker', async () => {
        const sessionId = 'probe-session'
        const projectPath = '/Users/tester/src/probe-project'
        const projectDir = getProjectPath(projectPath)
        const sessionFile = join(projectDir, `${sessionId}.jsonl`)

        await mkdir(projectDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'user',
                uuid: 'user-1',
                sessionId,
                cwd: projectPath,
                timestamp: '2026-01-01T00:00:00.000Z',
                message: { content: HAPI_METADATA_PROBE_MARKER }
            }),
            JSON.stringify({
                type: 'assistant',
                uuid: 'assistant-1',
                sessionId,
                cwd: projectPath,
                timestamp: '2026-01-01T00:00:01.000Z',
                message: { content: [{ text: 'response' }] }
            })
        ].join('\n') + '\n')

        const provider = createClaudeNativeProvider()
        const summaries = await provider.discoverSessions()

        expect(summaries).toHaveLength(0)
    })

    it('derives summary chronology from parseable native event timestamps instead of file mtime', async () => {
        const sessionId = 'claude-session-chronology'
        const projectPath = '/Users/tester/src/claude-chronology'
        const projectDir = getProjectPath(projectPath)
        const sessionFile = join(projectDir, `${sessionId}.jsonl`)

        await mkdir(projectDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'summary',
                summary: 'starting up',
                leafUuid: 'leaf-1',
                sessionId,
                cwd: projectPath,
                timestamp: 'not-a-date'
            }),
            JSON.stringify({
                type: 'user',
                uuid: 'user-1',
                sessionId,
                cwd: projectPath,
                timestamp: '2026-01-01T00:00:10.000Z',
                message: {
                    content: 'hello'
                }
            }),
            JSON.stringify({
                type: 'assistant',
                uuid: 'assistant-1',
                sessionId,
                cwd: projectPath,
                timestamp: '2026-01-01T00:00:20.000Z',
                message: {
                    content: [{ text: 'world' }]
                }
            })
        ].join('\n') + '\n')

        const inflatedMtime = new Date('2026-01-02T00:00:00.000Z')
        await utimes(sessionFile, inflatedMtime, inflatedMtime)

        const provider = createClaudeNativeProvider()
        const [summary] = await provider.discoverSessions()

        expect(summary).toEqual(expect.objectContaining({
            createdAt: Date.parse('2026-01-01T00:00:10.000Z'),
            lastActivityAt: Date.parse('2026-01-01T00:00:20.000Z')
        }))
    })

    it('falls back to file timestamps when native chronology is unavailable', async () => {
        const sessionId = 'claude-session-fallback'
        const projectPath = '/Users/tester/src/claude-fallback'
        const projectDir = getProjectPath(projectPath)
        const sessionFile = join(projectDir, `${sessionId}.jsonl`)

        await mkdir(projectDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'user',
                uuid: 'user-1',
                sessionId,
                cwd: projectPath,
                timestamp: 'not-a-date',
                message: {
                    content: 'hello'
                }
            }),
            JSON.stringify({
                type: 'assistant',
                uuid: 'assistant-1',
                sessionId,
                cwd: projectPath,
                timestamp: 'still-not-a-date',
                message: {
                    content: [{ text: 'world' }]
                }
            })
        ].join('\n') + '\n')

        const createdStat = await stat(sessionFile)
        const laterMtime = new Date(Math.floor((createdStat.birthtimeMs || createdStat.mtimeMs) + 60_000))
        await utimes(sessionFile, laterMtime, laterMtime)
        const adjustedStat = await stat(sessionFile)

        const provider = createClaudeNativeProvider()
        const [summary] = await provider.discoverSessions()

        expect(summary).toEqual(expect.objectContaining({
            createdAt: Math.floor(adjustedStat.birthtimeMs || adjustedStat.mtimeMs),
            lastActivityAt: Math.floor(adjustedStat.mtimeMs)
        }))
    })

    it('clamps fallback lastActivityAt to createdAt when file mtime is older than the creation fallback', async () => {
        const sessionId = 'claude-session-clamp'
        const projectPath = '/Users/tester/src/claude-clamp'
        const projectDir = getProjectPath(projectPath)
        const sessionFile = join(projectDir, `${sessionId}.jsonl`)

        await mkdir(projectDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'user',
                uuid: 'user-1',
                sessionId,
                cwd: projectPath,
                timestamp: 'not-a-date',
                message: {
                    content: 'hello'
                }
            }),
            JSON.stringify({
                type: 'assistant',
                uuid: 'assistant-1',
                sessionId,
                cwd: projectPath,
                timestamp: 'still-not-a-date',
                message: {
                    content: [{ text: 'world' }]
                }
            })
        ].join('\n') + '\n')

        const createdStat = await stat(sessionFile)
        const earlierMtime = new Date(Math.max(1, Math.floor((createdStat.birthtimeMs || createdStat.mtimeMs) - 60_000)))
        await utimes(sessionFile, earlierMtime, earlierMtime)
        const adjustedStat = await stat(sessionFile)

        const provider = createClaudeNativeProvider()
        const [summary] = await provider.discoverSessions()

        expect(summary).toEqual(expect.objectContaining({
            createdAt: Math.floor(adjustedStat.birthtimeMs || adjustedStat.mtimeMs),
            lastActivityAt: Math.floor(adjustedStat.birthtimeMs || adjustedStat.mtimeMs)
        }))
    })

    it('imports full history in source order', async () => {
        const fixture = await readFile(join(__dirname, '../../claude/utils/__fixtures__/1-continue-run-ls-tool.jsonl'), 'utf-8')
        const sessionId = '789e105f-ae33-486d-9271-0696266f072d'
        const projectPath = '/Users/kirilldubovitskiy/projects/happy/handy-cli/notes/test-project'
        const projectDir = getProjectPath(projectPath)

        await mkdir(projectDir, { recursive: true })
        await writeFile(join(projectDir, `${sessionId}.jsonl`), fixture)

        const provider = createClaudeNativeProvider()
        const [summary] = await provider.discoverSessions()
        const result = await provider.readMessages(summary, null)

        expect(result.messages.map((message) => message.sourceKey)).toEqual([
            'line:0',
            'line:1',
            'line:2',
            'line:3',
            'line:4',
            'line:5',
            'line:6'
        ])
        expect(result.messages[0].content).toEqual(expect.objectContaining({ type: 'summary' }))
        expect(result.messages[3].content).toEqual(expect.objectContaining({ type: 'user' }))
        expect(result.messages.at(-1)?.content).toEqual(expect.objectContaining({ type: 'assistant' }))
        expect(result.cursor).toBeTruthy()
        expect(result.filePath).toBe(join(projectDir, `${sessionId}.jsonl`))
    })

    it('tails only newly appended lines after the persisted cursor', async () => {
        const sessionId = 'tail-session'
        const projectPath = '/Users/tester/src/claude-tail-project'
        const projectDir = getProjectPath(projectPath)
        const sessionFile = join(projectDir, `${sessionId}.jsonl`)

        await mkdir(projectDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'user',
                uuid: 'user-1',
                sessionId,
                cwd: projectPath,
                timestamp: '2026-01-01T00:00:00.000Z',
                message: {
                    content: 'hello'
                }
            })
        ].join('\n') + '\n')

        const provider = createClaudeNativeProvider()
        const [summary] = await provider.discoverSessions()
        const initial = await provider.readMessages(summary, null)

        await appendFile(sessionFile, JSON.stringify({
            type: 'assistant',
            uuid: 'assistant-1',
            sessionId,
            cwd: projectPath,
            timestamp: '2026-01-01T00:00:01.000Z',
            message: {
                content: [{ text: 'world' }]
            }
        }) + '\n')

        const tail = await provider.readMessages(summary, {
            sessionId: 'hapi-session-1',
            provider: 'claude',
            nativeSessionId: sessionId,
            machineId: 'machine-1',
            cursor: initial.cursor,
            filePath: initial.filePath ?? null,
            mtime: initial.mtime ?? null,
            lastSyncedAt: 1,
            syncStatus: 'healthy',
            lastError: null
        })

        expect(tail.messages).toHaveLength(1)
        expect(tail.messages[0].sourceKey).toBe('line:1')
        expect(tail.messages[0].content).toEqual(expect.objectContaining({ type: 'assistant' }))
        expect(tail.cursor).not.toBe(initial.cursor)
    })
})
