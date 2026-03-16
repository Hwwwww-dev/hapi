import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { EnhancedMode } from './loop';

const harness = vi.hoisted(() => ({
    notifications: [] as Array<{ method: string; params: unknown }>,
    registerRequestCalls: [] as string[],
    interruptCalls: [] as Array<{ threadId: string; turnId: string }>,
    startTurnMode: 'complete' as 'complete' | 'pending-abort',
    turnId: ''
}));

vi.mock('./codexAppServerClient', () => {
    class MockCodexAppServerClient {
        private notificationHandler: ((method: string, params: unknown) => void) | null = null;

        async connect(): Promise<void> {}

        async initialize(): Promise<{ protocolVersion: number }> {
            return { protocolVersion: 1 };
        }

        setNotificationHandler(handler: ((method: string, params: unknown) => void) | null): void {
            this.notificationHandler = handler;
        }

        registerRequestHandler(method: string): void {
            harness.registerRequestCalls.push(method);
        }

        async startThread(): Promise<{ thread: { id: string } }> {
            return { thread: { id: 'thread-anonymous' } };
        }

        async resumeThread(): Promise<{ thread: { id: string } }> {
            return { thread: { id: 'thread-anonymous' } };
        }

        async startTurn(): Promise<{ turn: Record<string, never> }> {
            const started = {
                turn: harness.turnId ? { id: harness.turnId } : {}
            };
            harness.notifications.push({ method: 'turn/started', params: started });
            this.notificationHandler?.('turn/started', started);

            if (harness.startTurnMode === 'pending-abort') {
                return { turn: started.turn as Record<string, never> };
            }

            const completed = { status: 'Completed', turn: {} };
            harness.notifications.push({ method: 'turn/completed', params: completed });
            this.notificationHandler?.('turn/completed', completed);

            return { turn: {} };
        }

        async interruptTurn(params: { threadId: string; turnId: string }): Promise<Record<string, never>> {
            harness.interruptCalls.push(params);
            return {};
        }

        async disconnect(): Promise<void> {}
    }

    return { CodexAppServerClient: MockCodexAppServerClient };
});

vi.mock('./utils/buildHapiMcpBridge', () => ({
    buildHapiMcpBridge: async () => ({
        server: {
            stop: () => {}
        },
        mcpServers: {}
    })
}));

import { codexRemoteLauncher } from './codexRemoteLauncher';

type FakeAgentState = {
    requests: Record<string, unknown>;
    completedRequests: Record<string, unknown>;
};

function createMode(): EnhancedMode {
    return {
        permissionMode: 'default'
    };
}

function createSessionStub() {
    const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify(mode));
    queue.push('hello from launcher test', createMode());

    const sessionEvents: Array<{ type: string; [key: string]: unknown }> = [];
    const codexMessages: unknown[] = [];
    const thinkingChanges: boolean[] = [];
    const foundSessionIds: string[] = [];
    let agentState: FakeAgentState = {
        requests: {},
        completedRequests: {}
    };

    const rpcHandlers = new Map<string, (params: unknown) => unknown>();
    const client = {
        rpcHandlerManager: {
            registerHandler(method: string, handler: (params: unknown) => unknown) {
                rpcHandlers.set(method, handler);
            }
        },
        updateAgentState(handler: (state: FakeAgentState) => FakeAgentState) {
            agentState = handler(agentState);
        },
        sendCodexMessage(message: unknown) {
            codexMessages.push(message);
        },
        sendUserMessage(_text: string) {},
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            sessionEvents.push(event);
        }
    };

    const session = {
        path: '/tmp/hapi-update',
        logPath: '/tmp/hapi-update/test.log',
        client,
        queue,
        codexArgs: undefined,
        codexCliOverrides: undefined,
        sessionId: null as string | null,
        thinking: false,
        onThinkingChange(nextThinking: boolean) {
            session.thinking = nextThinking;
            thinkingChanges.push(nextThinking);
        },
        onSessionFound(id: string) {
            session.sessionId = id;
            foundSessionIds.push(id);
        },
        sendCodexMessage(message: unknown) {
            client.sendCodexMessage(message);
        },
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            client.sendSessionEvent(event);
        },
        sendUserMessage(text: string) {
            client.sendUserMessage(text);
        }
    };

    return {
        session,
        sessionEvents,
        codexMessages,
        thinkingChanges,
        foundSessionIds,
        rpcHandlers,
        queue,
        getAgentState: () => agentState
    };
}

describe('codexRemoteLauncher', () => {
    afterEach(() => {
        harness.notifications = [];
        harness.registerRequestCalls = [];
        harness.interruptCalls = [];
        harness.startTurnMode = 'complete';
        harness.turnId = '';
        delete process.env.CODEX_USE_MCP_SERVER;
    });

    it('finishes a turn and emits ready when task lifecycle events omit turn_id', async () => {
        delete process.env.CODEX_USE_MCP_SERVER;
        const {
            session,
            sessionEvents,
            thinkingChanges,
            foundSessionIds,
            queue
        } = createSessionStub();

        queue.close();
        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(foundSessionIds).toContain('thread-anonymous');
        expect(harness.notifications.map((entry) => entry.method)).toEqual(['turn/started', 'turn/completed']);
        expect(sessionEvents.filter((event) => event.type === 'ready').length).toBeGreaterThanOrEqual(1);
        expect(thinkingChanges).toContain(true);
        expect(session.thinking).toBe(false);
    });

    it('clears thinking state and emits ready after aborting an app-server turn', async () => {
        delete process.env.CODEX_USE_MCP_SERVER;
        harness.startTurnMode = 'pending-abort';
        harness.turnId = 'turn-abort-1';

        const {
            session,
            sessionEvents,
            rpcHandlers,
            queue
        } = createSessionStub();

        const launchPromise = codexRemoteLauncher(session as never);
        await vi.waitFor(() => {
            expect(session.thinking).toBe(true);
        });

        const abortHandler = rpcHandlers.get('abort');
        expect(abortHandler).toBeTypeOf('function');
        await abortHandler?.({});

        await vi.waitFor(() => {
            expect(harness.interruptCalls).toEqual([{ threadId: 'thread-anonymous', turnId: 'turn-abort-1' }]);
        });

        await vi.waitFor(() => {
            expect(session.thinking).toBe(false);
            expect(sessionEvents.some((event) => event.type === 'ready')).toBe(true);
        });

        queue.close();
        const exitReason = await launchPromise;
        expect(exitReason).toBe('exit');
    });
});
