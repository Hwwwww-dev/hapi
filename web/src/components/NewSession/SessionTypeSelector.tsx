import { Radio, Input } from '@arco-design/web-react'
import type { SessionType } from './types'
import { useTranslation } from '@/lib/use-translation'

export function SessionTypeSelector(props: {
    sessionType: SessionType
    worktreeName: string
    isDisabled: boolean
    onSessionTypeChange: (value: SessionType) => void
    onWorktreeNameChange: (value: string) => void
}) {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.type')}
            </label>
            <div className="flex flex-col gap-1.5">
                <Radio.Group
                    value={props.sessionType}
                    onChange={(val) => props.onSessionTypeChange(val as SessionType)}
                    disabled={props.isDisabled}
                    direction="vertical"
                >
                    <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 cursor-pointer min-h-[34px]">
                            <Radio value="simple">
                                <span className="text-sm capitalize">{t('newSession.type.simple')}</span>
                                <span className="text-xs text-[var(--app-hint)] ml-1">
                                    {t('newSession.type.simple.desc')}
                                </span>
                            </Radio>
                        </label>
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-1.5">
                            <Radio value="worktree">
                                <span className="text-sm capitalize cursor-pointer">
                                    {t('newSession.type.worktree')}
                                </span>
                                <span className="ml-2 text-xs text-[var(--app-hint)]">
                                    {t('newSession.type.worktree.desc')}
                                </span>
                            </Radio>
                            {props.sessionType === 'worktree' && (
                                <div className="ml-6">
                                    <Input
                                        placeholder={t('newSession.type.worktree.placeholder')}
                                        value={props.worktreeName}
                                        onChange={(val: string) => props.onWorktreeNameChange(val)}
                                        disabled={props.isDisabled}
                                        size="small"
                                        autoFocus
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </Radio.Group>
            </div>
        </div>
    )
}
