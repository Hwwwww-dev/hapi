import { Select } from '@arco-design/web-react'
import type { AgentType } from './types'
import { MODEL_OPTIONS } from './types'
import { useTranslation } from '@/lib/use-translation'

export function ModelSelector(props: {
    agent: AgentType
    model: string
    isDisabled: boolean
    onModelChange: (value: string) => void
}) {
    const { t } = useTranslation()
    const options = MODEL_OPTIONS[props.agent]
    if (options.length === 0) {
        return null
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.model')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <Select
                value={props.model}
                onChange={(val) => props.onModelChange(val)}
                disabled={props.isDisabled}
                className="w-full"
            >
                {options.map((option) => (
                    <Select.Option key={option.value} value={option.value}>
                        {option.label}
                    </Select.Option>
                ))}
            </Select>
        </div>
    )
}
