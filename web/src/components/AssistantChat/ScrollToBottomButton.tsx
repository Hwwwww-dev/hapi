import { IconArrowDown } from '@arco-design/web-react/icon'

export function ScrollToBottomButton(props: { visible: boolean; onClick: () => void }) {
    return (
        <div className={`absolute left-0 right-0 bottom-full flex justify-center pointer-events-none transition-opacity duration-200 pb-2 ${props.visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button
                onClick={props.onClick}
                className="pointer-events-auto flex items-center gap-1 rounded-full bg-[var(--app-bg)] border border-[var(--app-border)] px-3 py-1 text-xs text-[var(--app-hint)] shadow-sm hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] transition-colors"
                aria-label="Scroll to bottom"
            >
                <IconArrowDown style={{ fontSize: 14 }} />
            </button>
        </div>
    )
}
