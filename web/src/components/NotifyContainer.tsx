import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getNotifyItems, subscribeNotify, notify, type NotifyItem, type NotifyVariant } from '@/lib/notify'

const variantStyles: Record<NotifyVariant, { icon: string; color: string; bar: string }> = {
    success: { icon: '✓', color: 'text-emerald-500', bar: 'bg-emerald-500' },
    error: { icon: '✕', color: 'text-red-500', bar: 'bg-red-500' },
    warning: { icon: '!', color: 'text-amber-500', bar: 'bg-amber-500' },
    info: { icon: 'i', color: 'text-blue-500', bar: 'bg-blue-500' },
}

function NotifyMessage({ item, onDone }: { item: NotifyItem; onDone: () => void }) {
    const style = variantStyles[item.variant]
    const [leaving, setLeaving] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const dismiss = () => {
        if (leaving) return
        setLeaving(true)
        clearTimeout(timerRef.current)
        setTimeout(onDone, 200) // wait for fade-out animation
    }

    useEffect(() => {
        if (item.duration > 0) {
            timerRef.current = setTimeout(dismiss, item.duration)
        }
        return () => clearTimeout(timerRef.current)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div
            className={`relative pointer-events-auto flex w-fit max-w-[90vw] cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 shadow-lg transition-all duration-200 ${leaving ? 'animate-notify-out' : 'animate-slide-down-fade'}`}
            style={{ paddingTop: '0.625rem', paddingBottom: item.duration > 0 ? '0.75rem' : '0.625rem' }}
            role="status"
            onClick={dismiss}
        >
            <span className={`text-sm font-bold ${style.color}`}>{style.icon}</span>
            <span className="text-sm text-[var(--app-fg)] break-words">{item.message}</span>
            {item.duration > 0 && (
                <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-b-lg">
                    <div
                        className={`h-full ${style.bar} origin-left`}
                        style={{
                            animation: leaving ? 'none' : `notify-shrink ${item.duration}ms linear forwards`,
                        }}
                    />
                </div>
            )}
        </div>
    )
}

export function NotifyContainer() {
    const items = useSyncExternalStore(subscribeNotify, getNotifyItems)

    if (items.length === 0) return null

    return (
        <div
            className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+2rem)] z-[60] flex flex-col items-center gap-2 pointer-events-none"
            aria-live="polite"
        >
            {items.map((item) => (
                <NotifyMessage key={item.id} item={item} onDone={() => notify.remove(item.id)} />
            ))}
        </div>
    )
}
