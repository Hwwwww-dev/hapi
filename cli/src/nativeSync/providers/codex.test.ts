import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createCodexNativeProvider } from './codex'

describe('Codex native provider', () => {
    let tempDir: string
    let originalCodexHome: string | undefined

    beforeEach(async () => {
        tempDir = join(tmpdir(), `codex-native-provider-${Date.now()}`)
        await mkdir(tempDir, { recursive: true })
        originalCodexHome = process.env.CODEX_HOME
        process.env.CODEX_HOME = tempDir
    })

    afterEach(async () => {
        if (originalCodexHome === undefined) {
            delete process.env.CODEX_HOME
        } else {
            process.env.CODEX_HOME = originalCodexHome
        }

        if (existsSync(tempDir)) {
            await rm(tempDir, { recursive: true, force: true })
        }
    })

    it('enumerates Codex session files and derives project ownership from cwd', async () => {
        const sessionId = 'codex-session-1'
        const sessionDir = join(tempDir, 'sessions', '2026', '01', '01')
        const sessionFile = join(sessionDir, `codex-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-project',
                    timestamp: '2026-01-01T00:00:00.000Z'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'user_message',
                    message: 'write a release note'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'agent_message',
                    message: 'hello'
                }
            })
        ].join('\n') + '\n')

        const provider = createCodexNativeProvider()
        const summaries = await provider.discoverSessions()

        expect(summaries).toHaveLength(1)
        expect(summaries[0]).toEqual(expect.objectContaining({
            provider: 'codex',
            nativeSessionId: sessionId,
            projectPath: '/workspaces/codex-project',
            displayPath: '/workspaces/codex-project',
            flavor: 'codex',
            title: 'write a release note'
        }))
        expect(summaries[0].lastActivityAt).toBeGreaterThan(0)
    })

    it('derives a title from the first native Codex user message', async () => {
        const sessionId = 'codex-session-title'
        const sessionDir = join(tempDir, 'sessions', '2026', '01', '05')
        const sessionFile = join(sessionDir, `codex-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-title',
                    timestamp: '2026-01-05T00:00:00.000Z'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'user_message',
                    message: 'fix the failing test'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'agent_message',
                    message: 'working on it'
                }
            })
        ].join('\n') + '\n')

        const provider = createCodexNativeProvider()
        const summaries = await provider.discoverSessions()

        expect(summaries[0]?.title).toBe('fix the failing test')
    })

    it('imports full history in source order', async () => {
        const sessionId = 'codex-session-2'
        const sessionDir = join(tempDir, 'sessions', '2026', '01', '02')
        const sessionFile = join(sessionDir, `codex-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-project',
                    timestamp: '2026-01-02T00:00:00.000Z'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'agent_message',
                    message: 'hello'
                }
            }),
            JSON.stringify({
                type: 'response_item',
                payload: {
                    type: 'function_call',
                    name: 'write_file',
                    call_id: 'call-2',
                    arguments: '{}'
                }
            })
        ].join('\n') + '\n')

        const provider = createCodexNativeProvider()
        const [summary] = await provider.discoverSessions()
        const result = await provider.readMessages(summary, null)

        expect(result.messages.map((message) => message.sourceKey)).toEqual([
            'file:2026/01/02/codex-codex-session-2.jsonl:line:1',
            'file:2026/01/02/codex-codex-session-2.jsonl:line:2'
        ])
        expect(result.messages.map((message) => message.content)).toEqual([
            {
                role: 'agent',
                content: expect.objectContaining({
                    type: 'codex',
                    data: expect.objectContaining({
                        type: 'message',
                        message: 'hello'
                    })
                }),
                meta: {
                    sentFrom: 'cli'
                }
            },
            {
                role: 'agent',
                content: expect.objectContaining({
                    type: 'codex',
                    data: expect.objectContaining({
                        type: 'tool-call',
                        name: 'write_file'
                    })
                }),
                meta: {
                    sentFrom: 'cli'
                }
            }
        ])
        expect(result.cursor).toBeTruthy()
        expect(result.filePath).toBe(sessionFile)
    })

    it('resolves rollout-style Codex session files when importing history', async () => {
        const sessionId = '019ceb82-5e07-79c2-9b64-1a9903bbb578'
        const sessionDir = join(tempDir, 'sessions', '2026', '03', '14')
        const sessionFile = join(sessionDir, `rollout-2026-03-14T16-41-55-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-rollout',
                    timestamp: '2026-03-14T16:41:55.000Z'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'user_message',
                    message: 'resume this rollout'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'agent_message',
                    message: 'history imported'
                }
            })
        ].join('\n') + '\n')

        const provider = createCodexNativeProvider()
        const [summary] = await provider.discoverSessions()
        const result = await provider.readMessages(summary, null)

        expect(result.filePath).toBe(sessionFile)
        expect(result.messages).toHaveLength(2)
    })

    it('re-reads a small overlap near the persisted cursor so recent native messages can self-heal', async () => {
        const sessionId = 'codex-session-3'
        const sessionDir = join(tempDir, 'sessions', '2026', '01', '03')
        const sessionFile = join(sessionDir, `codex-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-tail',
                    timestamp: '2026-01-03T00:00:00.000Z'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'agent_message',
                    message: 'hello'
                }
            })
        ].join('\n') + '\n')

        const provider = createCodexNativeProvider()
        const [summary] = await provider.discoverSessions()
        const initial = await provider.readMessages(summary, null)
        const replay = await provider.readMessages(summary, {
            sessionId: 'hapi-session-1',
            provider: 'codex',
            nativeSessionId: sessionId,
            machineId: 'machine-1',
            cursor: initial.cursor,
            filePath: initial.filePath ?? null,
            mtime: initial.mtime ?? null,
            lastSyncedAt: 1,
            syncStatus: 'healthy',
            lastError: null
        })

        expect(replay.messages).toHaveLength(1)
        expect(replay.messages[0].sourceKey).toBe('file:2026/01/03/codex-codex-session-3.jsonl:line:1')

        await appendFile(sessionFile, JSON.stringify({
            type: 'response_item',
            payload: {
                type: 'function_call_output',
                call_id: 'call-1',
                output: {
                    ok: true
                }
            }
        }) + '\n')

        const tail = await provider.readMessages(summary, {
            sessionId: 'hapi-session-1',
            provider: 'codex',
            nativeSessionId: sessionId,
            machineId: 'machine-1',
            cursor: initial.cursor,
            filePath: initial.filePath ?? null,
            mtime: initial.mtime ?? null,
            lastSyncedAt: 1,
            syncStatus: 'healthy',
            lastError: null
        })

        expect(tail.messages).toHaveLength(2)
        expect(tail.messages[0].sourceKey).toBe('file:2026/01/03/codex-codex-session-3.jsonl:line:1')
        expect(tail.messages[1].sourceKey).toBe('file:2026/01/03/codex-codex-session-3.jsonl:line:2')
        expect(tail.messages[1].content).toEqual({
            role: 'agent',
            content: expect.objectContaining({
                type: 'codex',
                data: expect.objectContaining({
                    type: 'tool-call-result',
                    callId: 'call-1',
                    output: {
                        ok: true
                    }
                })
            }),
            meta: {
                sentFrom: 'cli'
            }
        })
        expect(tail.cursor).not.toBe(initial.cursor)
    })

    it('converts native Codex events into the same chat protocol used by live sessions', async () => {
        const sessionId = 'codex-session-4'
        const sessionDir = join(tempDir, 'sessions', '2026', '01', '04')
        const sessionFile = join(sessionDir, `codex-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-native',
                    timestamp: '2026-01-04T00:00:00.000Z'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'user_message',
                    message: 'write a test'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'agent_message',
                    message: 'done'
                }
            })
        ].join('\n') + '\n')

        const provider = createCodexNativeProvider()
        const [summary] = await provider.discoverSessions()
        const result = await provider.readMessages(summary, null)

        expect(result.messages).toHaveLength(2)
        expect(result.messages[0].content).toEqual({
            role: 'user',
            content: {
                type: 'text',
                text: 'write a test'
            },
            meta: {
                sentFrom: 'cli'
            }
        })
        expect(result.messages[1].content).toEqual({
            role: 'agent',
            content: expect.objectContaining({
                type: 'codex',
                data: expect.objectContaining({
                    type: 'message',
                    message: 'done'
                })
            }),
            meta: {
                sentFrom: 'cli'
            }
        })
    })

    it('uses top-level native timestamps for Codex messages that lack payload timestamps', async () => {
        const sessionId = 'codex-session-top-level-ts'
        const sessionDir = join(tempDir, 'sessions', '2026', '03', '15')
        const sessionFile = join(sessionDir, `rollout-2026-03-15T03-04-32-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                timestamp: '2026-03-14T19:04:33.901Z',
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-timestamps',
                    timestamp: '2026-03-14T19:04:32.306Z'
                }
            }),
            JSON.stringify({
                timestamp: '2026-03-15T14:20:42.770Z',
                type: 'event_msg',
                payload: {
                    type: 'user_message',
                    message: '我同意'
                }
            })
        ].join('\n') + '\n')

        const provider = createCodexNativeProvider()
        const [summary] = await provider.discoverSessions()
        const result = await provider.readMessages(summary, null)

        expect(result.messages).toHaveLength(1)
        expect(result.messages[0]?.createdAt).toBe(Date.parse('2026-03-15T14:20:42.770Z'))
    })
})
