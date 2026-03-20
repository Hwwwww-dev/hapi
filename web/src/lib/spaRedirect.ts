const SPA_REDIRECT_KEY = 'spaRedirect'
const APP_ROUTE_ROOTS = new Set(['sessions', 'settings'])

function normalizeBasePath(pathname: string): string {
    if (!pathname || pathname === '/') {
        return '/'
    }

    return pathname.endsWith('/') ? pathname : `${pathname}/`
}

export function getSpaRedirectBasePath(pathname: string): string {
    if (!pathname || pathname === '/') {
        return '/'
    }

    if (pathname === '/404.html') {
        return '/'
    }

    if (pathname.endsWith('/404.html')) {
        return normalizeBasePath(pathname.slice(0, -'404.html'.length))
    }

    const segments = pathname.split('/').filter(Boolean)
    const routeIndex = segments.findIndex((segment) => APP_ROUTE_ROOTS.has(segment))

    if (routeIndex === -1) {
        return '/'
    }

    const basePath = routeIndex === 0 ? '/' : `/${segments.slice(0, routeIndex).join('/')}`
    return normalizeBasePath(basePath)
}

/**
 * Stores the current path in sessionStorage before redirecting away from a static 404 page.
 */
export function storeSpaRedirect(): void {
    const path = window.location.pathname + window.location.search + window.location.hash
    sessionStorage.setItem(SPA_REDIRECT_KEY, path)
}

/**
 * Restores the path stored by storeSpaRedirect() using replaceState,
 * so the router boots with the original SPA URL.
 */
export function restoreSpaRedirect(): void {
    const redirect = sessionStorage.getItem(SPA_REDIRECT_KEY)
    if (!redirect) {
        return
    }

    sessionStorage.removeItem(SPA_REDIRECT_KEY)
    window.history.replaceState(null, '', redirect)
}
