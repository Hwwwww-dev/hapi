import { useEffect, useRef } from 'react'
import { useLocation, useRouter } from '@tanstack/react-router'
import { getLogicalParent } from '@/lib/route-hierarchy'

/**
 * History guard hook for PWA swipe-back navigation.
 *
 * Uses two-phase detection:
 * 1. Native `popstate` sets a flag (only fires on real browser back/forward)
 * 2. TanStack Router's `onResolved` checks the flag and corrects if needed
 *
 * This avoids both the tab-switching false positive (popstate doesn't fire
 * for programmatic navigate) and the rAF timing issue.
 */
export function useHistoryGuard() {
    const router = useRouter()
    const pathname = useLocation({ select: (l) => l.pathname })
    const prevPathRef = useRef(pathname)
    const pendingPopRef = useRef(false)

    useEffect(() => {
        prevPathRef.current = pathname
    }, [pathname])

    // Phase 1: flag real browser back/forward
    useEffect(() => {
        const handler = () => { pendingPopRef.current = true }
        window.addEventListener('popstate', handler)
        return () => window.removeEventListener('popstate', handler)
    }, [])

    // Phase 2: after route resolves, check and correct
    useEffect(() => {
        const unsubscribe = router.subscribe('onResolved', (event) => {
            if (!pendingPopRef.current) return
            pendingPopRef.current = false

            const fromPath = prevPathRef.current
            const currentPath = event.toLocation.pathname
            const expectedParent = getLogicalParent(fromPath)

            // Update tracking
            prevPathRef.current = currentPath

            if (!expectedParent) return
            if (currentPath.startsWith(fromPath + '/')) return
            if (currentPath === expectedParent) return

            void router.navigate({ to: expectedParent, replace: true })
        })

        return unsubscribe
    }, [router])
}
