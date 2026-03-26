import { Select } from '@arco-design/web-react'
import { useTranslation } from '@/lib/use-translation'
import type { AgentType, CodexReasoningEffort } from './types'
import { CODEX_REASONING_EFFORT_OPTIONS } from './types'

export function ReasoningEffortSelector(props: {
    agent: AgentType
    value: CodexReasoningEffort
    isDisabled: boolean
    onChange: (value: CodexReasoningEffort) => void
}) {
    const { t } = useTranslation()

    if (props.agent !== 'codex') {
        return null
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.reasoningEffort')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <Select
                value={props.value}
                onChange={(val) => props.onChange(val as CodexReasoningEffort)}
                disabled={props.isDisabled}
                className="w-full"
            >
                {CODEX_REASONING_EFFORT_OPTIONS.map((option) => (
                    <Select.Option key={option.value} value={option.value}>
                        {t(`newSession.reasoningEffort.${option.value}`)}
                    </Select.Option>
                ))}
            </Select>
        </div>
    )
}
