import { createContext, useContext, memo, type ComponentPropsWithoutRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Image as ArcoImage } from '@arco-design/web-react'
import type { CodeHeaderProps } from '@/chat/chat-types'
import remarkDisableIndentedCode from '@/lib/remark-disable-indented-code'
import remarkStripCjkAutolink from '@/lib/remark-strip-cjk-autolink'
import { cn } from '@/lib/utils'
import { SyntaxHighlighter } from '@/components/assistant-ui/shiki-highlighter'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { CopyIcon, CheckIcon } from '@/components/icons'

import type { MarkdownTextPrimitiveProps } from '@assistant-ui/react-markdown'

export const MARKDOWN_PLUGINS = [remarkGfm, remarkStripCjkAutolink, remarkMath, remarkDisableIndentedCode] satisfies NonNullable<MarkdownTextPrimitiveProps['remarkPlugins']>
export const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex] satisfies NonNullable<MarkdownTextPrimitiveProps['rehypePlugins']>

const CodeBlockContext = createContext(false)

/** 替代 useIsMarkdownCodeBlock，检测 code 元素是否在 pre（代码块）内 */
function useIsCodeBlock() {
    return useContext(CodeBlockContext)
}

function memoizeMarkdownComponents(
    components: Record<string, React.ComponentType<any>>
): Record<string, React.ComponentType<any>> {
    return Object.fromEntries(
        Object.entries(components).map(([key, Component]) => [
            key,
            memo(Component),
        ])
    )
}

function CodeHeader(props: CodeHeaderProps) {
    const { copied, copy } = useCopyToClipboard()
    const language = props.language && props.language !== 'unknown' ? props.language : ''

    return (
        <div className="aui-md-codeheader flex items-center justify-between rounded-t-md bg-[var(--app-code-bg)] px-2 py-1">
            <div className="min-w-0 flex-1 pr-2 text-xs font-mono text-[var(--app-hint)]">
                {language}
            </div>
            <button
                type="button"
                onClick={() => copy(props.code)}
                className="shrink-0 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                title="Copy"
            >
                {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
        </div>
    )
}

function Pre(props: ComponentPropsWithoutRef<'pre'>) {
    return (
        <CodeBlockContext.Provider value={true}>
            {props.children}
        </CodeBlockContext.Provider>
    )
}

function Code(props: ComponentPropsWithoutRef<'code'>) {
    const isCodeBlock = useIsCodeBlock()

    if (isCodeBlock) {
        const language = /language-(\w+)/.exec(props.className || '')?.[1] ?? ''
        const code = typeof props.children === 'string'
            ? props.children.replace(/\n$/, '')
            : String(props.children ?? '').replace(/\n$/, '')

        return (
            <>
                <CodeHeader language={language} code={code} />
                <SyntaxHighlighter language={language} code={code} />
            </>
        )
    }

    return (
        <code
            {...props}
            className={cn(
                'aui-md-code break-words rounded bg-[var(--app-inline-code-bg)] px-[0.3em] py-[0.1em] font-mono text-[length:var(--text-code)]',
                props.className
            )}
        />
    )
}

function A(props: ComponentPropsWithoutRef<'a'>) {
    const rel = props.target === '_blank' ? (props.rel ?? 'noreferrer') : props.rel

    return (
        <a
            {...props}
            rel={rel}
            className={cn('aui-md-a text-[var(--app-link)] underline', props.className)}
        />
    )
}

function Paragraph(props: ComponentPropsWithoutRef<'p'>) {
    return <p {...props} className={cn('aui-md-p my-2 leading-relaxed', props.className)} />
}

function Blockquote(props: ComponentPropsWithoutRef<'blockquote'>) {
    return (
        <blockquote
            {...props}
            className={cn(
                'aui-md-blockquote my-2 border-l-4 border-[var(--app-hint)] pl-3 text-[var(--app-hint)]',
                props.className
            )}
        />
    )
}

function UnorderedList(props: ComponentPropsWithoutRef<'ul'>) {
    return <ul {...props} className={cn('aui-md-ul my-2 list-disc pl-6', props.className)} />
}

function OrderedList(props: ComponentPropsWithoutRef<'ol'>) {
    return <ol {...props} className={cn('aui-md-ol my-2 list-decimal pl-6', props.className)} />
}

function ListItem(props: ComponentPropsWithoutRef<'li'>) {
    return <li {...props} className={cn('aui-md-li my-0.5', props.className)} />
}

function Hr(props: ComponentPropsWithoutRef<'hr'>) {
    return <hr {...props} className={cn('aui-md-hr my-4 border-[var(--app-divider)]', props.className)} />
}

function Table(props: ComponentPropsWithoutRef<'table'>) {
    const { className, ...rest } = props

    return (
        <div className="aui-md-table-wrapper my-2 max-w-full overflow-x-auto">
            <table {...rest} className={cn('aui-md-table w-full border-collapse', className)} />
        </div>
    )
}

function Thead(props: ComponentPropsWithoutRef<'thead'>) {
    return <thead {...props} className={cn('aui-md-thead', props.className)} />
}

function Tbody(props: ComponentPropsWithoutRef<'tbody'>) {
    return <tbody {...props} className={cn('aui-md-tbody', props.className)} />
}

function Tr(props: ComponentPropsWithoutRef<'tr'>) {
    return <tr {...props} className={cn('aui-md-tr', props.className)} />
}

function Th(props: ComponentPropsWithoutRef<'th'>) {
    return (
        <th
            {...props}
            className={cn(
                'aui-md-th border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1 text-left font-semibold',
                props.className
            )}
        />
    )
}

function Td(props: ComponentPropsWithoutRef<'td'>) {
    return <td {...props} className={cn('aui-md-td border border-[var(--app-border)] px-2 py-1', props.className)} />
}

function H1(props: ComponentPropsWithoutRef<'h1'>) {
    return <h1 {...props} className={cn('aui-md-h1 mt-4 mb-2 text-[1.25em] font-semibold border-b border-[var(--app-divider)] pb-1', props.className)} />
}

function H2(props: ComponentPropsWithoutRef<'h2'>) {
    return <h2 {...props} className={cn('aui-md-h2 mt-4 mb-2 text-[1.125em] font-semibold border-b border-[var(--app-divider)] pb-1', props.className)} />
}

function H3(props: ComponentPropsWithoutRef<'h3'>) {
    return <h3 {...props} className={cn('aui-md-h3 mt-3 mb-1 text-[1em] font-semibold', props.className)} />
}

function H4(props: ComponentPropsWithoutRef<'h4'>) {
    return <h4 {...props} className={cn('aui-md-h4 mt-3 mb-1 text-[0.875em] font-semibold', props.className)} />
}

function H5(props: ComponentPropsWithoutRef<'h5'>) {
    return <h5 {...props} className={cn('aui-md-h5 mt-2 mb-1 text-[0.875em] font-semibold', props.className)} />
}

function H6(props: ComponentPropsWithoutRef<'h6'>) {
    return <h6 {...props} className={cn('aui-md-h6 mt-2 mb-1 text-[0.8em] font-semibold text-[color:var(--app-hint)]', props.className)} />
}

function Strong(props: ComponentPropsWithoutRef<'strong'>) {
    return <strong {...props} className={cn('aui-md-strong font-semibold', props.className)} />
}

function Em(props: ComponentPropsWithoutRef<'em'>) {
    return <em {...props} className={cn('aui-md-em italic', props.className)} />
}

function Image(props: ComponentPropsWithoutRef<'img'>) {
    return (
        <ArcoImage
            {...props}
            src={props.src}
            alt={props.alt}
            className={cn('aui-md-img max-w-full rounded-lg', props.className)}
            preview={true}
            loader={true}
            style={{ maxWidth: '100%' }}
        />
    )
}

export const defaultComponents = memoizeMarkdownComponents({
    pre: Pre,
    code: Code,
    h1: H1,
    h2: H2,
    h3: H3,
    h4: H4,
    h5: H5,
    h6: H6,
    a: A,
    p: Paragraph,
    strong: Strong,
    em: Em,
    blockquote: Blockquote,
    ul: UnorderedList,
    ol: OrderedList,
    li: ListItem,
    hr: Hr,
    table: Table,
    thead: Thead,
    tbody: Tbody,
    tr: Tr,
    th: Th,
    td: Td,
    img: Image,
} as const)

export function MarkdownText({ text, size = 'body' }: { text: string; size?: 'body' | 'chat' }) {
    const { copied, copy } = useCopyToClipboard()
    const sizeClass = size === 'chat' ? 'text-[length:var(--text-chat-body)]' : 'text-[length:var(--text-body)]'

    return (
        <div className="aui-md-block group/text relative">
            <div className="rounded-lg px-2 py-1 transition-colors hover:bg-[var(--app-subtle-bg)]">
                <div className={cn('aui-md min-w-0 max-w-full break-words', sizeClass)}>
                    <Markdown
                        remarkPlugins={MARKDOWN_PLUGINS}
                        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                        components={defaultComponents}
                    >
                        {text}
                    </Markdown>
                </div>
            </div>
            {text && (
                <div className="flex justify-start opacity-60 transition-opacity hover:opacity-100">
                    <button
                        type="button"
                        onClick={() => copy(text)}
                        className="rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title="Copy"
                    >
                        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                    </button>
                </div>
            )}
        </div>
    )
}
