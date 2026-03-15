import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/lib/use-translation'

export function SessionSourceBadge(props: {
    source?: 'hapi' | 'native' | 'hybrid' | null
    className?: string
}) {
    const { t } = useTranslation()

    if (props.source === 'native') {
        return (
            <Badge variant="warning" className={props.className}>
                {t('session.source.native')}
            </Badge>
        )
    }

    if (props.source === 'hybrid') {
        return (
            <Badge variant="success" className={props.className}>
                {t('session.source.hybrid')}
            </Badge>
        )
    }

    return null
}
