import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import { CodeBlock } from '@/components/CodeBlock'
import { extractApplyPatchText } from '@/lib/applyPatch'

export function ApplyPatchView(props: ToolViewProps) {
    const patch = extractApplyPatchText(props.block.tool.input)
    if (!patch) return null

    return <CodeBlock code={patch} language="diff" />
}
