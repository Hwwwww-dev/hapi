import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import type { Session } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionHeader } from './SessionHeader'

vi.mock('@/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({
        archiveSession: vi.fn(),
        renameSession: vi.fn(),
        deleteSession: vi.fn(),
        abortSession: vi.fn(),
        switchSession: vi.fn(),
        setPermissionMode: vi.fn(),
        setModelMode: vi.fn(),
        isPending: false
    })
}))

function renderWithProviders(ui: React.ReactElement) {
    localStorage.setItem('hapi-lang', 'en')
    return render(
        <I18nProvider>
            {ui}
        </I18nProvider>
    )
}

afterEach(() => {
    cleanup()
})

describe('SessionHeader', () => {
    it('prefers metadata.name over generated summary title', () => {
        const session: Session = {
            id: 'session-1',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            active: true,
            activeAt: 2,
            metadata: {
                path: '/tmp/project-path',
                host: 'local',
                flavor: 'codex',
                name: 'Pinned Title',
                summary: {
                    text: 'Generated Title',
                    updatedAt: 1
                }
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 0
        }

        renderWithProviders(
            <SessionHeader
                session={session}
                onBack={vi.fn()}
                api={null}
            />
        )

        expect(screen.getByText('Pinned Title')).toBeInTheDocument()
        expect(screen.queryByText('Generated Title')).not.toBeInTheDocument()
    })

    it('uses generated summary title when metadata.name is absent', () => {
        const session: Session = {
            id: 'session-1',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            active: true,
            activeAt: 2,
            metadata: {
                path: '/tmp/project-path',
                host: 'local',
                flavor: 'codex',
                summary: {
                    text: 'Generated Title',
                    updatedAt: 1
                }
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 0
        }

        renderWithProviders(
            <SessionHeader
                session={session}
                onBack={vi.fn()}
                api={null}
            />
        )

        expect(screen.getByText('Generated Title')).toBeInTheDocument()
    })

    it('uses shared path fallback when explicit title is absent', () => {
        const session: Session = {
            id: 'session-12345678',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            active: true,
            activeAt: 2,
            metadata: {
                path: '/tmp/header-fallback-title',
                host: 'local',
                flavor: 'codex'
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 0
        }

        renderWithProviders(
            <SessionHeader
                session={session}
                onBack={vi.fn()}
                api={null}
            />
        )

        expect(screen.getByText('header-fallback-title')).toBeInTheDocument()
    })

    it('shows native session id for hybrid sessions', () => {
        const session: Session = {
            id: 'session-1',
            namespace: 'default',
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            active: true,
            activeAt: 2,
            metadata: {
                path: '/tmp/project',
                host: 'local',
                flavor: 'codex',
                source: 'hybrid',
                nativeProvider: 'codex',
                nativeSessionId: 'native-123'
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: false,
            thinkingAt: 0
        }

        renderWithProviders(
            <SessionHeader
                session={session}
                onBack={vi.fn()}
                api={null}
            />
        )

        expect(screen.getByText(/native-123/)).toBeInTheDocument()
    })
})
