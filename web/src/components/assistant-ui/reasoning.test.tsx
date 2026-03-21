import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { I18nContext, type I18nContextValue } from '@/lib/i18n-context'
import { ReasoningGroup } from './reasoning'

function renderWithI18n(locale: I18nContextValue['locale'], isTruncated: boolean) {
    const t = (key: string) => {
        if (key === 'chat.reasoning.truncated') {
            return locale === 'zh-CN'
                ? '思考内容过长，已截断'
                : 'Reasoning content was too long and has been truncated'
        }
        return key
    }

    return renderToStaticMarkup(
        <I18nContext.Provider value={{ t, locale, setLocale: vi.fn() }}>
            <ReasoningGroup isStreaming={false} isTruncated={isTruncated}>
                <div>body</div>
            </ReasoningGroup>
        </I18nContext.Provider>
    )
}

describe('ReasoningGroup', () => {
    it('shows truncated reasoning notice with zh-CN i18n', () => {
        const html = renderWithI18n('zh-CN', true)

        expect(html).toContain('思考内容过长，已截断')
    })

    it('does not show truncated reasoning notice when reasoning is complete', () => {
        const html = renderWithI18n('en', false)

        expect(html).not.toContain('Reasoning content was too long and has been truncated')
    })
})
