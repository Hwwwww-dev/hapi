import { useCallback } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { getLogicalParent } from '@/lib/route-hierarchy'

export function useAppGoBack(): () => void {
    const navigate = useNavigate()
    const pathname = useLocation({ select: (location) => location.pathname })

    return useCallback(() => {
        const parent = getLogicalParent(pathname)
        if (parent) {
            navigate({ to: parent, replace: true })
        } else {
            // Already at root, nowhere to go back
            navigate({ to: '/sessions', replace: true })
        }
    }, [navigate, pathname])
}
