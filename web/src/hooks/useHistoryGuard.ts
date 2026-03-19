import { useEffect, useRef } from 'react'
import { useLocation, useRouter } from '@tanstack/react-router'
import { getLogicalParent } from '@/lib/route-hierarchy'

const NAV_INDEX_KEY = '__navIndex'

/**
 * History guard hook for PWA swipe-back navigation.
 *
 * Layer 2 of the navigation optimization strategy:
 * Subscribes to TanStack Router's onResolved event (avoiding popstate race conditions)
 * and uses a monotonic index in history.state to distinguish forward/back navigation.
 * On back navigation, if the destination doesn't match the logical parent,
 * it corrects via replace navigation.
 */
export function useHistoryGuard() {
    const router = useRouter()
    const pathname = useLocation({ select: (l) => l.pathname })
    const prevPathRef = useRef(pathname)
    const indexRef = useRef(0)

    // Initialize or sync navIndex from history state
    useEffect(() => {
        const currentState = (window.history.state as Record<string, unknown>) ?? {}
        if (typeof currentState[NAV_INDEX_KEY] === 'number') {
            indexRef.current = currentState[NAV_INDEX_KEY] as number
        } else {
            window.history.replaceState(
                { ...currentState, [NAV_INDEX_KEY]: indexRef.current },
                ''
            )
        }
    }, [])

    // On each pathname change, increment index and stamp history state
    useEffect(() => {
        indexRef.current++
        const currentState = (window.history.state as Record<string, unknown>) ?? {}
        window.history.replaceState(
            { ...currentState, [NAV_INDEX_KEY]: indexRef.current },
            ''
        )
        prevPathRef.current = pathname
    }, [pathname])

    // Subscribe to router resolution to detect and correct back navigation
    useEffect(() => {
        const unsubscribe = router.subscribe('onResolved', (event) => {
            const state = (window.history.state as Record<string, unknown>) ?? {}
            const navIndex = typeof state[NAV_INDEX_KEY] === 'number'
                ? (state[NAV_INDEX_KEY] as number)
                : 0

            // Forward or same-level navigation — just update tracking
            // Only update prevPathRef when pathname actually changes (not tab/search replace)
            if (navIndex >= indexRef.current) {
                indexRef.current = navIndex
                if (event.toLocation.pathname !== prevPathRef.current) {
                    prevPathRef.current = event.toLocation.pathname
                }
                return
            }

            // Back navigation detected (index decreased)
            const currentPath = event.toLocation.pathname
            const expectedParent = getLogicalParent(prevPathRef.current)

            // Update tracking state
            indexRef.current = navIndex
            prevPathRef.current = currentPath

            // Correct if destination doesn't match logical parent
            if (expectedParent && currentPath !== expectedParent) {
                void router.navigate({ to: expectedParent, replace: true })
            }
        })

        return unsubscribe
    }, [router])
}
