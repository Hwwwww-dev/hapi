import * as React from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from '@arco-design/web-react/icon'
import { cn } from '@/lib/utils'

/* ────────────────────────────────────────────────────────
 * Custom Dialog layer — same API as the old Arco Modal adapter
 * so ALL consumers work without any changes.
 *
 * Styled to match FileViewDialog: custom overlay + centered panel
 * with close button in the top-right corner.
 * ──────────────────────────────────────────────────────── */

interface DialogContextValue {
    open: boolean
    setOpen: (v: boolean) => void
}
const DialogCtx = React.createContext<DialogContextValue>({ open: false, setOpen: () => {} })

/* ── Dialog (Root) ── */

interface DialogProps {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    children: React.ReactNode
}

export function Dialog({ open: controlledOpen, onOpenChange, children }: DialogProps) {
    const [uncontrolled, setUncontrolled] = React.useState(false)
    const isControlled = controlledOpen !== undefined
    const open = isControlled ? controlledOpen : uncontrolled

    const setOpen = React.useCallback(
        (v: boolean) => {
            if (!isControlled) setUncontrolled(v)
            onOpenChange?.(v)
        },
        [isControlled, onOpenChange]
    )

    return <DialogCtx.Provider value={{ open, setOpen }}>{children}</DialogCtx.Provider>
}

/* ── DialogTrigger ── */

interface DialogTriggerProps {
    asChild?: boolean
    children: React.ReactNode
}

export function DialogTrigger({ asChild, children }: DialogTriggerProps) {
    const { setOpen } = React.useContext(DialogCtx)

    if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as React.ReactElement<{ onClick?: React.MouseEventHandler }>, {
            onClick: (...args: unknown[]) => {
                const original = (children as React.ReactElement<{ onClick?: (...a: unknown[]) => void }>).props.onClick
                if (typeof original === 'function') original(...args)
                setOpen(true)
            }
        })
    }

    return (
        <span role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}>
            {children}
        </span>
    )
}

/* ── DialogContent ── */

export const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }>(
    ({ className, children, ...props }, ref) => {
        const { open, setOpen } = React.useContext(DialogCtx)

        // Close on Escape
        React.useEffect(() => {
            if (!open) return
            function onKey(e: KeyboardEvent) {
                if (e.key === 'Escape') setOpen(false)
            }
            document.addEventListener('keydown', onKey)
            return () => document.removeEventListener('keydown', onKey)
        }, [open, setOpen])

        // Prevent body scroll while open
        React.useEffect(() => {
            if (!open) return
            const prev = document.body.style.overflow
            document.body.style.overflow = 'hidden'
            return () => { document.body.style.overflow = prev }
        }, [open])

        if (!open) return null

        return createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
                {/* Backdrop */}
                <div className="absolute inset-0 bg-black/50 animate-backdrop-fade" onClick={() => setOpen(false)} />

                {/* Panel */}
                <div
                    ref={ref}
                    className={cn(
                        'relative flex flex-col bg-[var(--app-bg)] rounded-xl w-full max-h-[85dvh] shadow-xl animate-fade-in-scale',
                        'max-w-lg',
                        className
                    )}
                    {...props}
                >
                    {/* Close button — top right */}
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                        aria-label="Close"
                    >
                        <IconClose style={{ fontSize: 'var(--icon-md)' }} />
                    </button>

                    {/* Content */}
                    <div className="overflow-y-auto p-4">{children}</div>
                </div>
            </div>,
            document.body
        )
    }
)
DialogContent.displayName = 'DialogContent'

/* ── DialogHeader ── */

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left pr-8', className)} {...props} />
)

/* ── DialogTitle ── */

export const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h2
            ref={ref}
            className={cn('text-base font-semibold leading-none tracking-tight', className)}
            {...props}
        />
    )
)
DialogTitle.displayName = 'DialogTitle'

/* ── DialogDescription ── */

export const DialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
    ({ className, ...props }, ref) => (
        <p
            ref={ref}
            className={cn('text-sm text-[var(--app-hint)]', className)}
            {...props}
        />
    )
)
DialogDescription.displayName = 'DialogDescription'
