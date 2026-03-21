import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

/* ── variant / size → Tailwind class map (replaces CVA) ── */

const variantClasses = {
    default: 'bg-[var(--app-button)] text-[var(--app-button-text)] hover:opacity-90',
    secondary: 'bg-[var(--app-secondary-bg)] text-[var(--app-fg)] hover:opacity-90',
    outline: 'border border-[var(--app-border)] bg-transparent hover:bg-[var(--app-subtle-bg)]',
    destructive: 'bg-red-600 text-white hover:bg-red-600/90'
} as const

const sizeClasses = {
    default: 'h-9 px-4 py-2',
    sm: 'h-8 px-3',
    lg: 'h-10 px-8'
} as const

export type ButtonVariant = keyof typeof variantClasses
export type ButtonSize = keyof typeof sizeClasses

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    asChild?: boolean
    variant?: ButtonVariant
    size?: ButtonSize
}

const base =
    'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:pointer-events-none disabled:opacity-50'

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
        const cls = cn(base, variantClasses[variant], sizeClasses[size], className)

        // asChild: delegate rendering to the child element (backward compat)
        if (asChild) {
            return <Slot className={cls} ref={ref as React.Ref<HTMLElement>} {...(props as Record<string, unknown>)} />
        }

        return <button className={cls} ref={ref} {...props} />
    }
)
Button.displayName = 'Button'
