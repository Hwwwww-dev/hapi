import * as React from 'react'
import { Modal } from '@arco-design/web-react'
import { cn } from '@/lib/utils'

/* ────────────────────────────────────────────────────────
 * Adapter layer: exposes the same API as the old Radix Dialog
 * so ALL consumers (including DiffView, ToolCard, LoginPrompt,
 * CliOutputBlock, etc.) work without any changes.
 *
 * Internally uses Arco Design Modal.
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
                // call original onClick if present
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

        return (
            <Modal
                visible={open}
                onCancel={() => setOpen(false)}
                footer={null}
                closable={false}
                maskClosable
                mountOnEnter
                unmountOnExit
                alignCenter
                className={cn(
                    'max-w-lg rounded-xl bg-[var(--app-secondary-bg)] p-4 shadow-2xl animate-fade-in-scale',
                    className
                )}
                style={{ padding: 0, width: 'calc(100vw - 32px)' }}
                {...(props as Record<string, unknown>)}
            >
                <div ref={ref} className="max-h-[80vh] overflow-y-auto">{children}</div>
            </Modal>
        )
    }
)
DialogContent.displayName = 'DialogContent'

/* ── DialogHeader ── */

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
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
