import { beforeEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_BASE_FONT_SIZE,
    getBaseFontSizeOptions,
    getInitialBaseFontSize,
    initializeBaseFontSize,
} from './useBaseFontSize'

describe('useBaseFontSize helpers', () => {
    beforeEach(() => {
        window.localStorage.clear()
        document.documentElement.style.removeProperty('--text-body')
        document.documentElement.style.removeProperty('--text-code')
        document.documentElement.style.removeProperty('--text-caption')
        document.documentElement.style.removeProperty('--text-badge')
        document.documentElement.style.removeProperty('--text-chat-body')
    })

    it('returns the semantic size options', () => {
        expect(getBaseFontSizeOptions()).toEqual([
            { value: 'sm', labelKey: 'settings.display.baseFontSize.small' },
            { value: 'md', labelKey: 'settings.display.baseFontSize.medium' },
            { value: 'lg', labelKey: 'settings.display.baseFontSize.large' },
            { value: 'xl', labelKey: 'settings.display.baseFontSize.extraLarge' },
        ])
    })

    it('falls back to default when storage is empty or invalid', () => {
        expect(getInitialBaseFontSize()).toBe(DEFAULT_BASE_FONT_SIZE)

        window.localStorage.setItem('hapi-base-font-size', 'weird')
        expect(getInitialBaseFontSize()).toBe(DEFAULT_BASE_FONT_SIZE)
    })

    it('reads a valid stored base font size', () => {
        window.localStorage.setItem('hapi-base-font-size', 'xl')
        expect(getInitialBaseFontSize()).toBe('xl')
    })

    it('initializes all typography variables from the stored size', () => {
        window.localStorage.setItem('hapi-base-font-size', 'lg')

        initializeBaseFontSize()

        const style = document.documentElement.style
        expect(style.getPropertyValue('--text-body')).toBe('16px')
        expect(style.getPropertyValue('--text-code')).toBe('14px')
        expect(style.getPropertyValue('--text-caption')).toBe('13px')
        expect(style.getPropertyValue('--text-badge')).toBe('11px')
        expect(style.getPropertyValue('--text-chat-body')).toBe('17px')
    })
})
