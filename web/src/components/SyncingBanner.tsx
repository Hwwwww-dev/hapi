import { Alert } from '@arco-design/web-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

export function SyncingBanner({ isSyncing }: { isSyncing: boolean }) {
    const { t } = useTranslation()
    const isOnline = useOnlineStatus()

    // Don't show syncing banner when offline (OfflineBanner takes precedence)
    if (!isSyncing || !isOnline) {
        return null
    }

    return (
        <Alert
            type="info"
            banner
            closable={false}
            content={
                <div className="flex items-center justify-center gap-2">
                    <Spinner size="sm" label={null} className="text-[var(--app-banner-text)]" />
                    {t('syncing.title')}
                </div>
            }
            className={cn('fixed top-0 left-0 right-0 z-50 animate-slide-down-fade')}
        />
    )
}
