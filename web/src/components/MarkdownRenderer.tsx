import Markdown from 'react-markdown'
import { MARKDOWN_PLUGINS, MARKDOWN_REHYPE_PLUGINS, defaultComponents } from '@/components/assistant-ui/markdown-text'
import { cn } from '@/lib/utils'

interface MarkdownRendererProps {
    content: string
    className?: string
    components?: Record<string, React.ComponentType<any>>
}

export function MarkdownRenderer(props: MarkdownRendererProps) {
    const mergedComponents = props.components
        ? { ...defaultComponents, ...props.components }
        : defaultComponents

    return (
        <div className={cn('aui-md min-w-0 max-w-full break-words text-[length:var(--text-body)]', props.className)}>
            <Markdown
                remarkPlugins={MARKDOWN_PLUGINS}
                rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                components={mergedComponents}
            >
                {props.content}
            </Markdown>
        </div>
    )
}
