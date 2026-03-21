import { Radio } from '@arco-design/web-react'
import type { AgentType } from './types'
import { useTranslation } from '@/lib/use-translation'

export function AgentSelector(props: {
    agent: AgentType
    isDisabled: boolean
    onAgentChange: (value: AgentType) => void
}) {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.agent')}
            </label>
            <Radio.Group
                value={props.agent}
                onChange={(val) => props.onAgentChange(val as AgentType)}
                disabled={props.isDisabled}
                className="flex gap-3"
            >
                {(['claude', 'codex', 'cursor'] as const).map((agentType) => (
                    <Radio key={agentType} value={agentType}>
                        <span className="text-sm capitalize">{agentType}</span>
                    </Radio>
                ))}
            </Radio.Group>
        </div>
    )
}
