/**
 * Route hierarchy utilities for PWA navigation.
 * Defines the logical parent for each route, enabling swipe-back
 * to navigate to the parent route instead of browser history order.
 */

/**
 * Returns the logical parent path for a given pathname,
 * or null if the pathname is already at the root level.
 */
export function getLogicalParent(pathname: string): string | null {
    // Root — no parent
    if (pathname === '/sessions' || pathname === '/sessions/') return null

    // New session → sessions list
    if (pathname === '/sessions/new') return '/sessions'

    // Settings → sessions list
    if (pathname === '/settings') return '/sessions'

    // Single file view → files list
    if (pathname.match(/^\/sessions\/[^/]+\/file$/)) {
        return pathname.replace(/\/file$/, '/files')
    }

    // Sub-pages (files, terminal) → session detail
    if (pathname.match(/^\/sessions\/[^/]+\/(files|terminal)$/)) {
        return pathname.replace(/\/[^/]+$/, '')
    }

    // Session detail → sessions list
    if (pathname.startsWith('/sessions/')) {
        return pathname.replace(/\/[^/]+$/, '') || '/sessions'
    }

    return null
}
