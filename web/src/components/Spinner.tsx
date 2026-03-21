import { Spin } from '@arco-design/web-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

type SpinnerProps = {
    size?: 'sm' | 'md' | 'lg'
    className?: string
    label?: string | null
}

const sizeMap = { sm: 16, md: 20, lg: 24 } as const

export function Spinner({
    size = 'md',
    className,
    label
}: SpinnerProps) {
    const { t } = useTranslation()
    const effectiveLabel = label === undefined ? t('loading') : label
    const accessibilityProps = effectiveLabel === null
        ? { 'aria-hidden': true as const }
        : { role: 'status' as const, 'aria-label': effectiveLabel }

    return (
        <span className={cn('inline-flex text-[var(--app-hint)]', className)} {...accessibilityProps}>
            <Spin size={sizeMap[size]} />
        </span>
    )
}
