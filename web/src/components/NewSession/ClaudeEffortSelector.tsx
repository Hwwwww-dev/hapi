import { Select } from '@arco-design/web-react'
import { useTranslation } from '@/lib/use-translation'
import type { AgentType, ClaudeEffort } from './types'
import { CLAUDE_EFFORT_OPTIONS } from './types'

export function ClaudeEffortSelector(props: {
    agent: AgentType
    effort: ClaudeEffort
    isDisabled: boolean
    onEffortChange: (value: ClaudeEffort) => void
}) {
    const { t } = useTranslation()

    if (props.agent !== 'claude') {
        return null
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.effort')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <Select
                value={props.effort}
                onChange={(val) => props.onEffortChange(val as ClaudeEffort)}
                disabled={props.isDisabled}
                className="w-full"
            >
                {CLAUDE_EFFORT_OPTIONS.map((option) => (
                    <Select.Option key={option.value} value={option.value}>
                        {t(`newSession.effort.${option.value}`)}
                    </Select.Option>
                ))}
            </Select>
        </div>
    )
}
