import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
    children: ReactNode
    fallback?: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
}

/**
 * Error boundary for the chat area.
 * Catches render errors and shows a user-friendly recovery UI.
 *
 * Usage:
 *   <ChatErrorBoundary t={t}>
 *     <SessionChat ... />
 *   </ChatErrorBoundary>
 *
 * Because class components cannot call hooks, the translated strings
 * are injected via the `t` render prop passed from the parent.
 */
export class ChatErrorBoundary extends Component<
    Props & { t: (key: string) => string },
    State
> {
    constructor(props: Props & { t: (key: string) => string }) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ChatErrorBoundary]', error, info.componentStack)
    }

    handleReload = () => {
        this.setState({ hasError: false, error: null })
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback
            }

            const { t } = this.props

            return (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
                    <div className="text-[length:var(--text-heading)] font-semibold text-[var(--app-fg)]">
                        {t('errorBoundary.title')}
                    </div>
                    <div className="max-w-md text-[length:var(--text-body)] text-[var(--app-hint)]">
                        {t('errorBoundary.description')}
                    </div>
                    {this.state.error && (
                        <details className="max-w-md text-left">
                            <summary className="cursor-pointer text-[length:var(--text-caption)] text-[var(--app-hint)]">
                                {t('errorBoundary.details')}
                            </summary>
                            <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--app-secondary-bg)] p-2 text-xs text-[var(--app-hint)]">
                                {this.state.error.message}
                            </pre>
                        </details>
                    )}
                    <button
                        type="button"
                        onClick={this.handleReload}
                        className="rounded-lg bg-[var(--app-button)] px-4 py-2 text-[length:var(--text-body)] text-[var(--app-button-text)] transition-colors hover:opacity-90"
                    >
                        {t('errorBoundary.reload')}
                    </button>
                </div>
            )
        }

        return this.props.children
    }
}
