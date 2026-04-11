import { useEffect, useRef, useState, type FC, type PropsWithChildren } from 'react'
import Markdown from 'react-markdown'
import { IconRight } from '@arco-design/web-react/icon'
import { cn } from '@/lib/utils'
import { defaultComponents, MARKDOWN_PLUGINS, MARKDOWN_REHYPE_PLUGINS } from '@/components/assistant-ui/markdown-text'
import { useTranslation } from '@/lib/use-translation'

function WavyText({ text }: { text: string }) {
    return (
        <span className="wavy-text">
            {[...text].map((ch, i) => (
                <span key={i} style={{ animationDelay: `${i * 0.06}s` }}>{ch === ' ' ? '\u00A0' : ch}</span>
            ))}
        </span>
    )
}

function ShimmerDot() {
    return (
        <span className="inline-block w-1.5 h-1.5 bg-current rounded-full animate-pulse" />
    )
}

/**
 * Renders individual reasoning message part content with markdown support.
 */
export const Reasoning: FC<{ text: string }> = ({ text }) => {
    return (
        <div className={cn('aui-reasoning-content min-w-0 max-w-full break-words text-[length:var(--text-caption)] text-[var(--app-hint)]')}>
            <Markdown
                remarkPlugins={MARKDOWN_PLUGINS}
                rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                components={defaultComponents}
            >
                {text}
            </Markdown>
        </div>
    )
}

/**
 * Wraps consecutive reasoning parts in a collapsible container.
 * Shows shimmer effect while reasoning is streaming.
 */
export const ReasoningGroup: FC<PropsWithChildren<{
    isStreaming: boolean
    isTruncated: boolean
}>> = ({ children, isStreaming, isTruncated }) => {
    const [isOpen, setIsOpen] = useState(false)
    const autoExpandedRef = useRef(false)
    const { t } = useTranslation()

    // 当推理正在 streaming 时自动展开
    useEffect(() => {
        if (isStreaming) {
            setIsOpen(true)
            autoExpandedRef.current = true
        }
    }, [isStreaming])

    // streaming 结束后 5s 自动折叠（仅自动展开的才折叠）
    useEffect(() => {
        if (isStreaming || !isOpen || !autoExpandedRef.current) return
        const timer = setTimeout(() => {
            setIsOpen(false)
            autoExpandedRef.current = false
        }, 5000)
        return () => clearTimeout(timer)
    }, [isStreaming, isOpen])

    return (
        <div className="aui-reasoning-group my-2">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    'flex items-center gap-1.5 text-[length:var(--text-caption)] font-medium',
                    'text-[var(--app-hint)] hover:text-[var(--app-fg)]',
                    'transition-colors cursor-pointer select-none'
                )}
            >
                <IconRight
                    style={{ fontSize: 'var(--icon-xs)' }}
                    className={cn(
                        'transition-transform duration-200',
                        isOpen ? 'rotate-90' : ''
                    )}
                />
                <span>{isStreaming ? <WavyText text="Reasoning" /> : 'Reasoning'}</span>
                {isStreaming && (
                    <span className="flex items-center gap-1 ml-1 text-[var(--app-hint)]">
                        <ShimmerDot />
                    </span>
                )}
            </button>

            <div
                className={cn(
                    'overflow-hidden transition-all duration-200 ease-in-out',
                    isOpen ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0'
                )}
            >
                <div className="pl-4 pt-2 border-l-2 border-[var(--app-border)] ml-0.5">
                    {children}
                    {isTruncated ? (
                        <div className="mt-2 text-[length:var(--text-caption)] text-[var(--app-hint)]">
                            {t('chat.reasoning.truncated')}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    )
}
