import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import { isObject } from '@hapi/protocol'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

function extractReasoningText(result: unknown): string | null {
    if (typeof result === 'string') return result
    if (!isObject(result)) return null

    if (typeof result.content === 'string') return result.content
    if (typeof result.text === 'string') return result.text

    const output = isObject(result.output) ? result.output : null
    if (output) {
        if (typeof output.content === 'string') return output.content
        if (typeof output.text === 'string') return output.text
    }

    return null
}

export function CodexReasoningView(props: ToolViewProps) {
    const text = extractReasoningText(props.block.tool.result)
    if (!text) return null

    return <MarkdownRenderer content={text} />
}
