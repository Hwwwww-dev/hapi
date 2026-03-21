import * as React from 'react'
import { Tag } from '@arco-design/web-react'
import { cn } from '@/lib/utils'

const variantClasses = {
    default: 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)]',
    warning: 'border-[var(--app-badge-warning-border)] bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]',
    success: 'border-[var(--app-badge-success-border)] bg-[var(--app-badge-success-bg)] text-[var(--app-badge-success-text)]',
    destructive: 'border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
} as const

export type BadgeVariant = keyof typeof variantClasses

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: BadgeVariant
}

export function Badge({ className, variant = 'default', children, ...props }: BadgeProps) {
    return (
        <Tag
            className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
                variantClasses[variant],
                className
            )}
            {...(props as Record<string, unknown>)}
        >
            {children}
        </Tag>
    )
}
