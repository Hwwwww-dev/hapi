import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useTranslation } from '@/lib/use-translation'

export function OfflineBanner({ sseConnected }: { sseConnected: boolean }) {
    const { t } = useTranslation()
    const browserOnline = useOnlineStatus()

    // Only show offline banner when BOTH browser reports offline AND SSE is disconnected
    if (browserOnline || sseConnected) {
        return null
    }

    return (
        <div className="fixed top-0 left-0 right-0 bg-amber-500 text-white text-center py-2 text-sm font-medium z-50 animate-slide-down-fade">
            {t('offline.message')}
        </div>
    )
}
