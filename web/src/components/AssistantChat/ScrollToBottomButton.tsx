import { IconArrowDown } from '@arco-design/web-react/icon'
import { useTranslation } from '@/lib/use-translation'

export function ScrollToBottomButton(props: { visible: boolean; count?: number; onClick: () => void }) {
    const { t } = useTranslation()
    const hasNew = (props.count ?? 0) > 0

    return (
        <div className={`absolute left-1/2 -translate-x-1/2 bottom-full pb-2 transition-opacity duration-200 ${props.visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button
                onClick={props.onClick}
                className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm shadow-sm transition-colors whitespace-nowrap ${
                    hasNew
                        ? 'bg-[var(--app-button)] text-[var(--app-button-text)] border-transparent font-medium'
                        : 'bg-[var(--app-bg)] text-[var(--app-hint)] border-[var(--app-border)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'
                }`}
                aria-label="Scroll to bottom"
            >
                {hasNew ? (
                    <>{t('misc.newMessage', { n: props.count! })} &#8595;</>
                ) : (
                    <IconArrowDown style={{ fontSize: 'var(--icon-md)' }} />
                )}
            </button>
        </div>
    )
}
