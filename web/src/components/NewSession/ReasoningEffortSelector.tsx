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
            <label htmlFor="new-session-reasoning-effort" className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.reasoningEffort')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <select
                id="new-session-reasoning-effort"
                value={props.value}
                onChange={(e) => props.onChange(e.target.value as CodexReasoningEffort)}
                disabled={props.isDisabled}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                {CODEX_REASONING_EFFORT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                        {t(`newSession.reasoningEffort.${option}`)}
                    </option>
                ))}
            </select>
        </div>
    )
}
