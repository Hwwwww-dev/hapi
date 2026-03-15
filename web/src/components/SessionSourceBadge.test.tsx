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
    it('renders Native badge for native sessions', () => {
        renderWithProviders(<SessionSourceBadge source="native" />)

        expect(screen.getByText('Native')).toBeInTheDocument()
    })

    it('renders Hybrid badge for hybrid sessions', () => {
        renderWithProviders(<SessionSourceBadge source="hybrid" />)

        expect(screen.getByText('Hybrid')).toBeInTheDocument()
    })
})
