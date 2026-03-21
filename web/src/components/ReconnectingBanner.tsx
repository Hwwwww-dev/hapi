import { Alert } from '@arco-design/web-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function getReasonLabel(reason: string, t: (key: string) => string): string {
    if (reason === 'heartbeat-timeout') {
        return t('reconnecting.reason.heartbeatTimeout')
    }
    if (reason === 'closed') {
        return t('reconnecting.reason.closed')
    }
    if (reason === 'error') {
        return t('reconnecting.reason.error')
    }
    return reason
}

export function ReconnectingBanner({
    isReconnecting,
    reason
}: {
    isReconnecting: boolean
    reason?: string | null
}) {
    const { t } = useTranslation()
    const isOnline = useOnlineStatus()
    const reasonLabel = reason ? getReasonLabel(reason, t) : null

    // Don't show if offline (OfflineBanner takes precedence) or if not reconnecting
    if (!isReconnecting || !isOnline) {
        return null
    }

    return (
        <Alert
            type="warning"
            banner
            showIcon={false}
            closable={false}
            content={
                <div className="flex items-center justify-center gap-2">
                    <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    {t('reconnecting.message')}
                    {reasonLabel ? <span className="opacity-90">({reasonLabel})</span> : null}
                </div>
            }
            className={cn('fixed top-0 left-0 right-0 z-50 animate-slide-down-fade')}
        />
    )
}
