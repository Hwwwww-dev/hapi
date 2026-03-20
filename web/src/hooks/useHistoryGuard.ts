import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { getLogicalParent } from '@/lib/route-hierarchy'

/**
 * History guard hook for PWA swipe-back navigation.
 *
 * Uses a single closure to track the current path, avoiding React timing
 * issues. Also prevents back-navigation past the sessions list by replacing
 * the history entry when arriving at /sessions.
 */
export function useHistoryGuard() {
    const router = useRouter()

    useEffect(() => {
        let lastKnownPath = window.location.pathname

        const onPopstate = () => {
            const fromPath = lastKnownPath
            const currentPath = window.location.pathname
            lastKnownPath = currentPath

            // At sessions root — block further back by replacing history entry
            if (currentPath === '/sessions' || currentPath === '/sessions/') {
                window.history.replaceState(window.history.state, '', currentPath)
                return
            }

            const expectedParent = getLogicalParent(fromPath)
            if (!expectedParent) return
            if (currentPath === expectedParent) return
            if (currentPath.startsWith(fromPath + '/')) return

            queueMicrotask(() => {
                void router.navigate({ to: expectedParent, replace: true })
            })
        }

        // Keep lastKnownPath in sync for programmatic navigation
        const unsubscribe = router.subscribe('onResolved', (event) => {
            lastKnownPath = event.toLocation.pathname
        })

        window.addEventListener('popstate', onPopstate)
        return () => {
            window.removeEventListener('popstate', onPopstate)
            unsubscribe()
        }
    }, [router])
}
