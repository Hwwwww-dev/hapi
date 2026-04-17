import type { ComponentType } from 'react'
import type { ToolCallBlock } from '@/chat/types'
import type { SessionMetadataSummary } from '@/types/api'
import { CodeBlock } from '@/components/CodeBlock'
import { CodexDiffCompactView, CodexDiffFullView } from '@/components/ToolCard/views/CodexDiffView'
import { CodexPatchView } from '@/components/ToolCard/views/CodexPatchView'
import { ApplyPatchView } from '@/components/ToolCard/views/ApplyPatchView'
import { CodexReasoningView } from '@/components/ToolCard/views/CodexReasoningView'
import { EditView } from '@/components/ToolCard/views/EditView'
import { AskUserQuestionView } from '@/components/ToolCard/views/AskUserQuestionView'
import { RequestUserInputView } from '@/components/ToolCard/views/RequestUserInputView'
import { ExitPlanModeView } from '@/components/ToolCard/views/ExitPlanModeView'
import { MultiEditFullView, MultiEditView } from '@/components/ToolCard/views/MultiEditView'
import { TodoWriteView } from '@/components/ToolCard/views/TodoWriteView'
import { UpdatePlanView } from '@/components/ToolCard/views/UpdatePlanView'
import { WriteView } from '@/components/ToolCard/views/WriteView'
import { canonicalizeToolName } from '@/lib/toolNames'
import { isObject } from '@hapi/protocol'
import { getInputStringAny } from '@/lib/toolInputUtils'

export type ToolViewProps = {
    block: ToolCallBlock
    metadata: SessionMetadataSummary | null
}

export type ToolViewComponent = ComponentType<ToolViewProps>

function AgentInputView({ block }: ToolViewProps) {
    const input = block.tool.input as Record<string, unknown> | null | undefined
    if (!input) return null
    const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : null
    const description = typeof input.description === 'string' ? input.description : null
    const prompt = typeof input.prompt === 'string' ? input.prompt : null
    return (
        <div className="flex flex-col gap-3">
            {subagentType && (
                <div>
                    <div className="mb-1 text-[length:var(--text-caption)] font-medium text-[var(--app-hint)]">subagent_type</div>
                    <span className="rounded-md bg-[var(--app-secondary-bg)] px-2 py-1 font-mono text-[length:var(--text-caption)] text-[var(--app-fg)]">{subagentType}</span>
                </div>
            )}
            {description && (
                <div>
                    <div className="mb-1 text-[length:var(--text-caption)] font-medium text-[var(--app-hint)]">description</div>
                    <div className="text-[length:var(--text-body)] text-[var(--app-fg)]">{description}</div>
                </div>
            )}
            {prompt && (
                <div>
                    <div className="mb-1 text-[length:var(--text-caption)] font-medium text-[var(--app-hint)]">prompt</div>
                    <CodeBlock code={prompt} language="text" />
                </div>
            )}
        </div>
    )
}

const SkillFullView: ToolViewComponent = ({ block }: ToolViewProps) => {
    const skillName = getInputStringAny(block.tool.input, ['skill'])
    return (
        <div className="text-sm text-[var(--app-fg)]">
            {skillName ?? 'Unknown skill'}
        </div>
    )
}

const AgentFullView: ToolViewComponent = ({ block }: ToolViewProps) => {
    const input = block.tool.input
    const description = getInputStringAny(input, ['description'])
    const subagentType = getInputStringAny(input, ['subagent_type'])
    const runInBackground = isObject(input) && input.run_in_background === true

    return (
        <div className="flex flex-col gap-1 text-sm">
            {description && (
                <div className="text-[var(--app-fg)]">{description}</div>
            )}
            <div className="flex gap-3 text-[var(--app-hint)]">
                {subagentType && <span>Type: {subagentType}</span>}
                {runInBackground && <span>Background</span>}
            </div>
        </div>
    )
}

export const toolViewRegistry: Record<string, ToolViewComponent> = {
    Edit: EditView,
    MultiEdit: MultiEditView,
    Write: WriteView,
    TodoWrite: TodoWriteView,
    update_plan: UpdatePlanView,
    CodexDiff: CodexDiffCompactView,
    CodexReasoning: CodexReasoningView,
    apply_patch: ApplyPatchView,
    AskUserQuestion: AskUserQuestionView,
    ExitPlanMode: ExitPlanModeView,
    ask_user_question: AskUserQuestionView,
    exit_plan_mode: ExitPlanModeView,
    request_user_input: RequestUserInputView
}

export const toolFullViewRegistry: Record<string, ToolViewComponent> = {
    Task: AgentInputView,
    Edit: EditView,
    MultiEdit: MultiEditFullView,
    Write: WriteView,
    CodexDiff: CodexDiffFullView,
    CodexPatch: CodexPatchView,
    apply_patch: ApplyPatchView,
    Skill: SkillFullView,
    Agent: AgentFullView,
    AskUserQuestion: AskUserQuestionView,
    ExitPlanMode: ExitPlanModeView,
    ask_user_question: AskUserQuestionView,
    exit_plan_mode: ExitPlanModeView,
    request_user_input: RequestUserInputView
}

export function getToolViewComponent(toolName: string): ToolViewComponent | null {
    return toolViewRegistry[canonicalizeToolName(toolName)] ?? null
}

export function getToolFullViewComponent(toolName: string): ToolViewComponent | null {
    return toolFullViewRegistry[canonicalizeToolName(toolName)] ?? null
}
