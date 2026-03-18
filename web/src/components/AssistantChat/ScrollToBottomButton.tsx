export function ScrollToBottomButton(props: { visible: boolean; onClick: () => void }) {
    return (
        <div className={`flex justify-center pointer-events-none transition-all duration-200 ${props.visible ? 'h-8 opacity-100 mb-1' : 'h-0 opacity-0'}`}>
            <button
                onClick={props.onClick}
                className="pointer-events-auto flex items-center gap-1 rounded-full bg-[var(--app-subtle-bg)] px-3 py-1 text-xs text-[var(--app-hint)] shadow-sm hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] transition-colors"
                aria-label="Scroll to bottom"
            >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
            </button>
        </div>
    )
}
