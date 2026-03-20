import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSpaRedirectBasePath, restoreSpaRedirect, storeSpaRedirect } from './spaRedirect'

describe('spaRedirect', () => {
    beforeEach(() => {
        sessionStorage.clear()
        vi.spyOn(window.history, 'replaceState')
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('getSpaRedirectBasePath', () => {
        it('uses root base for root deployments', () => {
            expect(getSpaRedirectBasePath('/sessions/abc123')).toBe('/')
            expect(getSpaRedirectBasePath('/settings')).toBe('/')
        })

        it('preserves repo subpath before known app routes', () => {
            expect(getSpaRedirectBasePath('/hapi/sessions/abc123')).toBe('/hapi/')
            expect(getSpaRedirectBasePath('/hapi/settings')).toBe('/hapi/')
        })

        it('handles 404.html under a subpath deployment', () => {
            expect(getSpaRedirectBasePath('/hapi/404.html')).toBe('/hapi/')
            expect(getSpaRedirectBasePath('/404.html')).toBe('/')
        })
    })

    describe('restoreSpaRedirect', () => {
        it('restores stored path via replaceState', () => {
            sessionStorage.setItem('spaRedirect', '/sessions/abc123')

            restoreSpaRedirect()

            expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/sessions/abc123')
        })

        it('removes spaRedirect from sessionStorage after restoring', () => {
            sessionStorage.setItem('spaRedirect', '/sessions/abc123')

            restoreSpaRedirect()

            expect(sessionStorage.getItem('spaRedirect')).toBeNull()
        })

        it('does nothing when spaRedirect is not set', () => {
            restoreSpaRedirect()

            expect(window.history.replaceState).not.toHaveBeenCalled()
        })

        it('preserves query string and hash in restored path', () => {
            sessionStorage.setItem('spaRedirect', '/sessions/abc123?foo=bar#section')

            restoreSpaRedirect()

            expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/sessions/abc123?foo=bar#section')
        })
    })

    describe('storeSpaRedirect', () => {
        it('stores the current pathname in sessionStorage', () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/sessions/abc123', search: '', hash: '' },
                configurable: true,
            })

            storeSpaRedirect()

            expect(sessionStorage.getItem('spaRedirect')).toBe('/sessions/abc123')
        })

        it('stores pathname with search and hash', () => {
            Object.defineProperty(window, 'location', {
                value: { pathname: '/sessions/abc123', search: '?foo=bar', hash: '#section' },
                configurable: true,
            })

            storeSpaRedirect()

            expect(sessionStorage.getItem('spaRedirect')).toBe('/sessions/abc123?foo=bar#section')
        })
    })
})
