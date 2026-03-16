import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFile, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
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

    it('derives summary chronology from session_meta payload timestamps and non-session activity', async () => {
        const sessionId = 'codex-session-chronology'
        const sessionDir = join(tempDir, 'sessions', '2026', '01', '06')
        const sessionFile = join(sessionDir, `codex-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                timestamp: '2026-01-01T00:00:30.000Z',
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-chronology',
                    timestamp: '2026-01-01T00:00:05.000Z'
                }
            }),
            JSON.stringify({
                timestamp: 'not-a-date',
                type: 'event_msg',
                payload: {
                    type: 'user_message',
                    message: 'start here'
                }
            }),
            JSON.stringify({
                timestamp: '2026-01-01T00:00:20.000Z',
                type: 'event_msg',
                payload: {
                    type: 'agent_message',
                    message: 'done'
                }
            })
        ].join('\n') + '\n')

        const inflatedMtime = new Date('2026-01-02T00:00:00.000Z')
        await utimes(sessionFile, inflatedMtime, inflatedMtime)

        const provider = createCodexNativeProvider()
        const [summary] = await provider.discoverSessions()

        expect(summary).toEqual(expect.objectContaining({
            createdAt: Date.parse('2026-01-01T00:00:05.000Z'),
            lastActivityAt: Date.parse('2026-01-01T00:00:20.000Z')
        }))
    })

    it('falls back to session_meta payload timestamp when non-session events have no native timestamp', async () => {
        const sessionId = 'codex-session-meta-fallback'
        const sessionDir = join(tempDir, 'sessions', '2026', '01', '07')
        const sessionFile = join(sessionDir, `codex-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-meta-fallback',
                    timestamp: '2026-01-07T00:00:05.000Z'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'user_message',
                    message: 'hello'
                }
            })
        ].join('\n') + '\n')

        const provider = createCodexNativeProvider()
        const [summary] = await provider.discoverSessions()

        expect(summary).toEqual(expect.objectContaining({
            createdAt: Date.parse('2026-01-07T00:00:05.000Z'),
            lastActivityAt: Date.parse('2026-01-07T00:00:05.000Z')
        }))
    })

    it('falls back to file timestamps when neither session_meta nor events provide chronology', async () => {
        const sessionId = 'codex-session-file-fallback'
        const sessionDir = join(tempDir, 'sessions', '2026', '01', '08')
        const sessionFile = join(sessionDir, `codex-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-file-fallback'
                }
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: {
                    type: 'user_message',
                    message: 'hello'
                }
            })
        ].join('\n') + '\n')

        const createdStat = await stat(sessionFile)
        const laterMtime = new Date(Math.floor((createdStat.birthtimeMs || createdStat.mtimeMs) + 60_000))
        await utimes(sessionFile, laterMtime, laterMtime)
        const adjustedStat = await stat(sessionFile)

        const provider = createCodexNativeProvider()
        const [summary] = await provider.discoverSessions()

        expect(summary).toEqual(expect.objectContaining({
            createdAt: Math.floor(adjustedStat.birthtimeMs || adjustedStat.mtimeMs),
            lastActivityAt: Math.floor(adjustedStat.mtimeMs)
        }))
    })

    it('clamps lastActivityAt to createdAt when session_meta is newer than the last event timestamp', async () => {
        const sessionId = 'codex-session-clamp'
        const sessionDir = join(tempDir, 'sessions', '2026', '01', '09')
        const sessionFile = join(sessionDir, `codex-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-clamp',
                    timestamp: '2026-01-09T00:00:30.000Z'
                }
            }),
            JSON.stringify({
                timestamp: '2026-01-09T00:00:20.000Z',
                type: 'event_msg',
                payload: {
                    type: 'agent_message',
                    message: 'done'
                }
            })
        ].join('\n') + '\n')

        const provider = createCodexNativeProvider()
        const [summary] = await provider.discoverSessions()

        expect(summary).toEqual(expect.objectContaining({
            createdAt: Date.parse('2026-01-09T00:00:30.000Z'),
            lastActivityAt: Date.parse('2026-01-09T00:00:30.000Z')
        }))
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
        const result = await provider.readMessages(summary, null, {
            sessionId: 'hapi-session-1',
            ingestedAt: 5000
        })

        expect(result.events.map((event) => event.sourceKey)).toEqual([
            'file:2026/01/02/codex-codex-session-2.jsonl:line:0',
            'file:2026/01/02/codex-codex-session-2.jsonl:line:1',
            'file:2026/01/02/codex-codex-session-2.jsonl:line:2'
        ])
        expect(result.events.map((event) => event.sourceOrder)).toEqual([0, 1, 2])
        expect(result.events[0]).toEqual(expect.objectContaining({
            sessionId: 'hapi-session-1',
            provider: 'codex',
            source: 'native',
            sourceSessionId: sessionId,
            sourceKey: 'file:2026/01/02/codex-codex-session-2.jsonl:line:0',
            sourceOrder: 0,
            channel: 'codex:file:2026/01/02/codex-codex-session-2.jsonl',
            rawType: 'session_meta',
            payload: expect.objectContaining({
                type: 'session_meta',
                payload: expect.objectContaining({
                    id: sessionId
                })
            })
        }))
        expect(result.events[1]).toEqual(expect.objectContaining({
            rawType: 'event_msg',
            observationKey: null,
            payload: expect.objectContaining({
                type: 'event_msg',
                payload: expect.objectContaining({
                    type: 'agent_message',
                    message: 'hello'
                })
            })
        }))
        expect(result.events[2]).toEqual(expect.objectContaining({
            rawType: 'response_item',
            observationKey: 'codex:call_id:call-2',
            payload: expect.objectContaining({
                type: 'response_item',
                payload: expect.objectContaining({
                    type: 'function_call',
                    name: 'write_file',
                    call_id: 'call-2'
                })
            })
        }))
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
        const result = await provider.readMessages(summary, null, {
            sessionId: 'hapi-session-1',
            ingestedAt: 5100
        })

        expect(result.filePath).toBe(sessionFile)
        expect(result.events).toHaveLength(3)
    })

    it('re-reads a small overlap near the persisted cursor only after the native file changes', async () => {
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
        const initial = await provider.readMessages(summary, null, {
            sessionId: 'hapi-session-1',
            ingestedAt: 5200
        })
        const unchanged = await provider.readMessages(summary, {
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
        }, {
            sessionId: 'hapi-session-1',
            ingestedAt: 5201
        })

        expect(unchanged.events).toHaveLength(0)
        expect(unchanged.cursor).toBe(initial.cursor)

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
        const updatedMtime = new Date((initial.mtime ?? 0) + 1_000)
        await utimes(sessionFile, updatedMtime, updatedMtime)

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
        }, {
            sessionId: 'hapi-session-1',
            ingestedAt: 5202
        })

        expect(tail.events).toHaveLength(3)
        expect(tail.events.map((event) => event.sourceKey)).toEqual([
            'file:2026/01/03/codex-codex-session-3.jsonl:line:0',
            'file:2026/01/03/codex-codex-session-3.jsonl:line:1',
            'file:2026/01/03/codex-codex-session-3.jsonl:line:2'
        ])
        expect(tail.events[0]?.id).toBe(initial.events[0]?.id)
        expect(tail.events[1]?.id).toBe(initial.events[1]?.id)
        expect(tail.events[2]).toEqual(expect.objectContaining({
            rawType: 'response_item',
            observationKey: 'codex:call_id:call-1',
            payload: expect.objectContaining({
                type: 'response_item',
                payload: expect.objectContaining({
                    type: 'function_call_output',
                    call_id: 'call-1',
                    output: {
                        ok: true
                    }
                })
            })
        }))
        expect(tail.cursor).not.toBe(initial.cursor)
    })

    it('preserves raw Codex payloads without reshaping them into UI messages', async () => {
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
        const result = await provider.readMessages(summary, null, {
            sessionId: 'hapi-session-1',
            ingestedAt: 5300
        })

        expect(result.events).toHaveLength(3)
        expect(result.events[1]).toEqual(expect.objectContaining({
            rawType: 'event_msg',
            payload: {
                type: 'event_msg',
                payload: {
                    type: 'user_message',
                    message: 'write a test'
                }
            }
        }))
        expect(result.events[2]).toEqual(expect.objectContaining({
            rawType: 'event_msg',
            payload: {
                type: 'event_msg',
                payload: {
                    type: 'agent_message',
                    message: 'done'
                }
            }
        }))
    })

    it('preserves malformed Codex rows as ingest-error raw events', async () => {
        const sessionId = 'codex-session-ingest-error'
        const sessionDir = join(tempDir, 'sessions', '2026', '01', '10')
        const sessionFile = join(sessionDir, `codex-${sessionId}.jsonl`)

        await mkdir(sessionDir, { recursive: true })
        await writeFile(sessionFile, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: sessionId,
                    cwd: '/workspaces/codex-ingest-error',
                    timestamp: '2026-01-10T00:00:00.000Z'
                }
            }),
            '{not-json',
            JSON.stringify({
                payload: {
                    bad: true
                }
            }),
            JSON.stringify({
                type: 'response_item',
                payload: {
                    type: 'function_call_output',
                    call_id: 'call-9',
                    output: {
                        ok: true
                    }
                }
            })
        ].join('\n') + '\n')

        const provider = createCodexNativeProvider()
        const [summary] = await provider.discoverSessions()
        const result = await provider.readMessages(summary, null, {
            sessionId: 'hapi-session-1',
            ingestedAt: 5400
        })

        expect(result.events.map((event) => event.rawType)).toEqual([
            'session_meta',
            'ingest-error',
            'ingest-error',
            'response_item'
        ])
        expect(result.events[1]).toEqual(expect.objectContaining({
            sourceKey: 'file:2026/01/10/codex-codex-session-ingest-error.jsonl:line:1',
            sourceOrder: 1,
            occurredAt: Date.parse('2026-01-10T00:00:00.000Z'),
            payload: expect.objectContaining({
                stage: 'json-parse',
                rawPreview: '{not-json'
            })
        }))
        expect(result.events[2]).toEqual(expect.objectContaining({
            sourceKey: 'file:2026/01/10/codex-codex-session-ingest-error.jsonl:line:2',
            sourceOrder: 2,
            occurredAt: Date.parse('2026-01-10T00:00:00.000Z'),
            payload: expect.objectContaining({
                stage: 'schema-parse',
                rawPreview: expect.stringContaining('"bad":true')
            })
        }))
        expect(result.events[3]).toEqual(expect.objectContaining({
            observationKey: 'codex:call_id:call-9'
        }))
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
        const result = await provider.readMessages(summary, null, {
            sessionId: 'hapi-session-1',
            ingestedAt: 5500
        })

        expect(result.events).toHaveLength(2)
        expect(result.events[1]?.occurredAt).toBe(Date.parse('2026-03-15T14:20:42.770Z'))
    })
})
