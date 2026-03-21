import { useEffect } from 'react'
import { Alert } from '@arco-design/web-react'
import { useVoiceOptional } from '@/lib/voice-context'
import { cn } from '@/lib/utils'

export function VoiceErrorBanner() {
    const voice = useVoiceOptional()

    const shouldShow = voice && voice.status === 'error' && voice.errorMessage

    useEffect(() => {
        if (!shouldShow || !voice) return

        const timer = setTimeout(() => {
            voice.setStatus('disconnected')
        }, 3000)

        return () => clearTimeout(timer)
    }, [shouldShow, voice])

    if (!shouldShow) {
        return null
    }

    return (
        <Alert
            type="error"
            banner
            closable={false}
            content={voice.errorMessage}
            className={cn('fixed top-0 left-0 right-0 z-50 animate-slide-down-fade')}
        />
    )
}
