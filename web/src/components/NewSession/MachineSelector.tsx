import { Select } from '@arco-design/web-react'
import type { Machine } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'

function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

export function MachineSelector(props: {
    machines: Machine[]
    machineId: string | null
    isLoading?: boolean
    isDisabled: boolean
    onChange: (machineId: string) => void
}) {
    const { t } = useTranslation()

    const selectOptions: { value: string; label: string }[] = []

    if (props.isLoading) {
        selectOptions.push({ value: '', label: t('loading.machines') })
    } else if (props.machines.length === 0) {
        selectOptions.push({ value: '', label: t('misc.noMachines') })
    }

    for (const m of props.machines) {
        const label = getMachineTitle(m) + (m.metadata?.platform ? ` (${m.metadata.platform})` : '')
        selectOptions.push({ value: m.id, label })
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.machine')}
            </label>
            <Select
                value={props.machineId ?? ''}
                onChange={(val) => props.onChange(val)}
                disabled={props.isDisabled}
                className="w-full"
            >
                {selectOptions.map((opt) => (
                    <Select.Option key={opt.value} value={opt.value}>
                        {opt.label}
                    </Select.Option>
                ))}
            </Select>
        </div>
    )
}
