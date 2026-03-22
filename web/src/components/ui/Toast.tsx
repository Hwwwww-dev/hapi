import * as React from 'react'
import { IconClose } from '@arco-design/web-react/icon'
import { cn } from '@/lib/utils'

export type ToastProps = React.HTMLAttributes<HTMLDivElement> & {
    title: string
    body: string
    onClose?: () => void
    variant?: 'default'
}

export function Toast({ title, body, onClose, className, variant, ...props }: ToastProps) {
    const handleClose = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        onClose?.()
    }

    return (
        <div
            className={cn(
                'pointer-events-auto w-full max-w-sm rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] shadow-xl backdrop-blur-sm animate-fade-in-up',
                className
            )}
            role="status"
            {...props}
        >
            <div className="flex items-start gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-5">{title}</div>
                    <div className="mt-1 text-xs leading-4 text-[var(--app-hint)]">{body}</div>
                </div>
                {onClose ? (
                    <button
                        type="button"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        onClick={handleClose}
                        aria-label="Dismiss"
                    >
                        <IconClose style={{ fontSize: 'var(--icon-xs)' }} />
                    </button>
                ) : null}
            </div>
        </div>
    )
}
