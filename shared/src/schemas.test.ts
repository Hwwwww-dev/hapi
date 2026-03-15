import { describe, expect, it } from 'vitest'

import { MetadataSchema } from './schemas'

describe('MetadataSchema', () => {
    it('parses native session metadata fields and preserves existing fields', () => {
        const metadata = {
            path: '/tmp/project',
            host: 'local',
            name: 'demo-session',
            codexSessionId: 'codex-existing-session',
            source: 'native' as const,
            nativeProvider: 'codex' as const,
            nativeSessionId: 'native-session-123',
            nativeProjectPath: '/tmp/project',
            nativeDiscoveredAt: 1710000000000,
            nativeLastSyncedAt: 1710000005000
        }

        expect(MetadataSchema.parse(metadata)).toEqual(metadata)
    })

    it('keeps native session metadata fields optional', () => {
        const metadata = {
            path: '/tmp/project',
            host: 'local',
            name: 'demo-session'
        }

        expect(MetadataSchema.parse(metadata)).toEqual(metadata)
    })
})
