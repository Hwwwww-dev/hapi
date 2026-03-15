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
            flavor: 'codex'
        }))
        expect(summaries[0].lastActivityAt).toBeGreaterThan(0)
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

    it('tails only appended events after the persisted cursor', async () => {
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

        expect(tail.messages).toHaveLength(1)
        expect(tail.messages[0].sourceKey).toBe('file:2026/01/03/codex-codex-session-3.jsonl:line:2')
        expect(tail.messages[0].content).toEqual({
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
})
