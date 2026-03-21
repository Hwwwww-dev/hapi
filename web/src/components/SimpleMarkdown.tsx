import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from '@/components/CodeBlock'

/**
 * Standalone markdown renderer that does NOT depend on assistant-ui context.
 * Use this in pages outside the chat thread (e.g., /files).
 * For chat messages, use MarkdownRenderer instead.
 */
export function SimpleMarkdown({ content, className }: { content: string; className?: string }) {
    return (
        <div className={className ?? 'prose prose-sm dark:prose-invert max-w-none break-words'}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    code({ className: codeClassName, children, ...props }) {
                        const match = /language-(\w+)/.exec(codeClassName || '')
                        const text = String(children).replace(/\n$/, '')
                        if (match) {
                            return <CodeBlock code={text} language={match[1]} />
                        }
                        return (
                            <code className="rounded bg-[var(--app-secondary-bg)] px-1 py-0.5 text-[0.85em] font-mono" {...props}>
                                {children}
                            </code>
                        )
                    },
                    pre({ children }) {
                        return <>{children}</>
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    )
}
