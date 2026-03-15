import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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

describe('SessionHeader', () => {
    it('shows hybrid source badge and native session id', () => {
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

        expect(screen.getByText('Hybrid')).toBeInTheDocument()
        expect(screen.getByText(/native-123/)).toBeInTheDocument()
    })
})
