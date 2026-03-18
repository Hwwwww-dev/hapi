import { useCallback } from 'react'
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router'

export function useAppGoBack(): () => void {
    const navigate = useNavigate()
    const router = useRouter()
    const pathname = useLocation({ select: (location) => location.pathname })

    return useCallback(() => {
        if (pathname === '/sessions/new') {
            navigate({ to: '/sessions' })
            return
        }

        if (pathname === '/settings') {
            navigate({ to: '/sessions' })
            return
        }

        // For single file view, go back to files list
        if (pathname.match(/^\/sessions\/[^/]+\/file$/)) {
            navigate({ to: pathname.replace(/\/file$/, '/files') })
            return
        }

        // For session routes, navigate to parent path
        if (pathname.startsWith('/sessions/')) {
            const parentPath = pathname.replace(/\/[^/]+$/, '') || '/sessions'
            navigate({ to: parentPath })
            return
        }

        router.history.back()
    }, [navigate, pathname, router])
}
