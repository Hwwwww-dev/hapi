import { describe, expect, it } from 'vitest'

import type { Session } from './schemas'
import { toSessionSummary } from './sessionSummary'

describe('toSessionSummary', () => {
    it('includes native session identity fields in summary metadata', () => {
        const session: Session = {
            id: 'session-1',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            active: false,
            activeAt: 1,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                flavor: 'codex',
                source: 'native',
                nativeProvider: 'codex',
                nativeSessionId: 'native-123'
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 0,
            todos: undefined,
            teamState: undefined,
            permissionMode: undefined,
            modelMode: undefined
        }

        expect(toSessionSummary(session).metadata).toEqual(expect.objectContaining({
            source: 'native',
            nativeProvider: 'codex',
            nativeSessionId: 'native-123'
        }))
    })
})
