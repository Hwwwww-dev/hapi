import { useState, useCallback } from 'react'
import { usePlatform } from './usePlatform'
import { safeCopyToClipboard } from '@/lib/clipboard'
import { notify } from '@/lib/notify'
import { useTranslation } from '@/lib/use-translation'

export function useCopyToClipboard(resetDelay = 1500) {
    const [copied, setCopied] = useState(false)
    const { haptic } = usePlatform()
    const { t } = useTranslation()

    const copy = useCallback(async (text: string, successMessage?: string) => {
        try {
            await safeCopyToClipboard(text)
            haptic.notification('success')
            notify.success(successMessage ?? t('notify.copied'))
            setCopied(true)
            setTimeout(() => setCopied(false), resetDelay)
            return true
        } catch {
            haptic.notification('error')
            notify.error(t('notify.copyFailed'))
            return false
        }
    }, [haptic, resetDelay, t])

    return { copied, copy }
}
