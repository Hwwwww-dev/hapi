import { Alert } from '@arco-design/web-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

export function OfflineBanner() {
    const { t } = useTranslation()
    const isOnline = useOnlineStatus()

    if (isOnline) {
        return null
    }

    return (
        <Alert
            type="warning"
            banner
            showIcon={false}
            closable={false}
            content={t('offline.message')}
            className={cn('fixed top-0 left-0 right-0 z-50 animate-slide-down-fade')}
        />
    )
}
