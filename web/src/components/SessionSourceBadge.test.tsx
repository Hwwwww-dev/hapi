import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider } from '@/lib/i18n-context'
import { SessionSourceBadge } from './SessionSourceBadge'

function renderWithProviders(ui: React.ReactElement) {
    localStorage.setItem('hapi-lang', 'en')
    return render(
        <I18nProvider>
            {ui}
        </I18nProvider>
    )
}

describe('SessionSourceBadge', () => {
    it('does not render a source badge for native sessions', () => {
        renderWithProviders(<SessionSourceBadge source="native" />)

        expect(screen.queryByText('Native')).not.toBeInTheDocument()
    })

    it('does not render a source badge for hybrid sessions', () => {
        renderWithProviders(<SessionSourceBadge source="hybrid" />)

        expect(screen.queryByText('Hybrid')).not.toBeInTheDocument()
    })
})
