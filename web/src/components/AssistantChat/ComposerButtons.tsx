import { ComposerPrimitive } from '@assistant-ui/react'
import type { ConversationStatus } from '@/realtime/types'
import { useTranslation } from '@/lib/use-translation'
import {
    IconVoice,
    IconSound,
    IconMute,
    IconSettings,
    IconMobile,
    IconCommand,
    IconAttachment,
    IconSend,
    IconRecordStop,
    IconLoading,
} from '@arco-design/web-react/icon'

const iconSize18 = { fontSize: 18 }
const iconSize16 = { fontSize: 16 }
const iconSize14 = { fontSize: 14 }

function UnifiedButton(props: {
    canSend: boolean
    voiceStatus: ConversationStatus
    voiceEnabled: boolean
    controlsDisabled: boolean
    onSend: () => void
    onVoiceToggle: () => void
}) {
    const { t } = useTranslation()

    // Determine button state
    const isConnecting = props.voiceStatus === 'connecting'
    const isConnected = props.voiceStatus === 'connected'
    const isVoiceActive = isConnecting || isConnected
    const hasText = props.canSend

    // Determine button behavior
    const handleClick = () => {
        if (isVoiceActive) {
            props.onVoiceToggle() // Stop voice
        } else if (hasText) {
            props.onSend() // Send message
        } else if (props.voiceEnabled) {
            props.onVoiceToggle() // Start voice
        }
    }

    // Determine button style and icon
    let icon: React.ReactNode
    let className: string
    let ariaLabel: string

    if (isConnecting) {
        icon = <IconLoading spin style={iconSize16} />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('voice.connecting')
    } else if (isConnected) {
        icon = <IconRecordStop style={iconSize14} />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.stop')
    } else if (hasText) {
        icon = <IconSend style={iconSize16} />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.send')
    } else if (props.voiceEnabled) {
        icon = <IconVoice style={iconSize18} />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.voice')
    } else {
        icon = <IconSend style={iconSize16} />
        className = 'bg-[var(--app-hint)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.send')
    }

    const isDisabled = props.controlsDisabled || (!hasText && !props.voiceEnabled && !isVoiceActive)

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isDisabled}
            aria-label={ariaLabel}
            title={ariaLabel}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        >
            {icon}
        </button>
    )
}

export function ComposerButtons(props: {
    canSend: boolean
    controlsDisabled: boolean
    showSettingsButton: boolean
    onSettingsToggle: () => void
    showTerminalButton: boolean
    terminalDisabled: boolean
    onTerminal: () => void
    showAbortButton: boolean
    abortDisabled: boolean
    isAborting: boolean
    onAbort: () => void
    showSwitchButton: boolean
    switchDisabled: boolean
    isSwitching: boolean
    onSwitch: () => void
    voiceEnabled: boolean
    voiceStatus: ConversationStatus
    voiceMicMuted?: boolean
    onVoiceToggle: () => void
    onVoiceMicToggle?: () => void
    onSend: () => void
}) {
    const { t } = useTranslation()
    const isVoiceConnected = props.voiceStatus === 'connected'

    return (
        <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-1">
                <ComposerPrimitive.AddAttachment
                    aria-label={t('composer.attach')}
                    title={t('composer.attach')}
                    disabled={props.controlsDisabled}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <IconAttachment style={iconSize18} />
                </ComposerPrimitive.AddAttachment>

                {props.showSettingsButton ? (
                    <button
                        type="button"
                        aria-label={t('composer.settings')}
                        title={t('composer.settings')}
                        className="settings-button flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)]"
                        onClick={props.onSettingsToggle}
                        disabled={props.controlsDisabled}
                    >
                        <IconSettings style={iconSize18} />
                    </button>
                ) : null}

                {props.showTerminalButton ? (
                    <button
                        type="button"
                        aria-label={t('composer.terminal')}
                        title={t('composer.terminal')}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={props.onTerminal}
                        disabled={props.terminalDisabled}
                    >
                        <IconCommand style={iconSize18} />
                    </button>
                ) : null}

                {props.showAbortButton ? (
                    <button
                        type="button"
                        aria-label={t('composer.abort')}
                        title={t('composer.abort')}
                        disabled={props.abortDisabled}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={props.onAbort}
                    >
                        {props.isAborting ? <IconLoading spin style={iconSize18} /> : <IconRecordStop style={iconSize18} />}
                    </button>
                ) : null}

                {props.showSwitchButton ? (
                    <button
                        type="button"
                        aria-label={t('composer.switchRemote')}
                        title={t('composer.switchRemote')}
                        disabled={props.switchDisabled}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={props.onSwitch}
                    >
                        <IconMobile style={iconSize18} />
                    </button>
                ) : null}

                {isVoiceConnected && props.onVoiceMicToggle ? (
                    <button
                        type="button"
                        aria-label={props.voiceMicMuted ? t('voice.unmute') : t('voice.mute')}
                        title={props.voiceMicMuted ? t('voice.unmute') : t('voice.mute')}
                        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                            props.voiceMicMuted
                                ? 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                : 'text-[var(--app-fg)]/60 hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)]'
                        }`}
                        onClick={props.onVoiceMicToggle}
                    >
                        {props.voiceMicMuted ? <IconMute style={iconSize18} /> : <IconSound style={iconSize18} />}
                    </button>
                ) : null}
            </div>

            <UnifiedButton
                canSend={props.canSend}
                voiceStatus={props.voiceStatus}
                voiceEnabled={props.voiceEnabled}
                controlsDisabled={props.controlsDisabled}
                onSend={props.onSend}
                onVoiceToggle={props.onVoiceToggle}
            />
        </div>
    )
}
