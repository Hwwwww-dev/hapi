import { useRef } from 'react'
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

const iconSizeLg = { fontSize: 'var(--icon-xl)' }
const iconSizeMd = { fontSize: 'var(--icon-xl)' }
const iconSizeSm = { fontSize: 'var(--icon-xl)' }

function UnifiedButton(props: {
    canSend: boolean
    hasContent: boolean
    voiceStatus: ConversationStatus
    voiceEnabled: boolean
    controlsDisabled: boolean
    onSend: () => void
    onEnqueue: () => void
    onVoiceToggle: () => void
}) {
    const { t } = useTranslation()

    // Determine button state
    const isConnecting = props.voiceStatus === 'connecting'
    const isConnected = props.voiceStatus === 'connected'
    const isVoiceActive = isConnecting || isConnected

    // Determine button behavior
    const handleClick = () => {
        if (isVoiceActive) {
            props.onVoiceToggle() // Stop voice
        } else if (props.canSend) {
            props.onSend() // Direct send
        } else if (props.hasContent) {
            props.onEnqueue() // Enqueue when thread is running
        } else if (props.voiceEnabled) {
            props.onVoiceToggle() // Start voice
        }
    }

    // Determine button style and icon — use hasContent (not canSend) so
    // the send icon stays visible while the thread is running.
    let icon: React.ReactNode
    let className: string
    let ariaLabel: string

    if (isConnecting) {
        icon = <IconLoading spin style={iconSizeMd} />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('voice.connecting')
    } else if (isConnected) {
        icon = <IconRecordStop style={iconSizeSm} />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.stop')
    } else if (props.hasContent) {
        icon = <IconSend style={iconSizeMd} />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.send')
    } else if (props.voiceEnabled) {
        icon = <IconVoice style={iconSizeLg} />
        className = 'bg-[var(--app-button)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.voice')
    } else {
        icon = <IconSend style={iconSizeMd} />
        className = 'bg-[var(--app-hint)] text-[var(--app-button-text)]'
        ariaLabel = t('composer.send')
    }

    const isDisabled = props.controlsDisabled || (!props.hasContent && !props.voiceEnabled && !isVoiceActive)

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
    hasContent: boolean
    controlsDisabled: boolean
    showSettingsButton: boolean
    onSettingsToggle: () => void
    showTerminalButton: boolean
    terminalDisabled: boolean
    terminalLabel: string
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
    onAddAttachment: (file: File) => void
    onVoiceMicToggle?: () => void
    onSend: () => void
    onEnqueue: () => void
}) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const { t } = useTranslation()
    const isVoiceConnected = props.voiceStatus === 'connected'

    return (
        <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-1">
                <>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="*/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                            const files = e.target.files
                            if (files) {
                                for (const file of files) {
                                    props.onAddAttachment(file)
                                }
                            }
                            e.target.value = ''
                        }}
                    />
                    <button
                        type="button"
                        aria-label={t('composer.attach')}
                        title={t('composer.attach')}
                        disabled={props.controlsDisabled}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <IconAttachment style={iconSizeLg} />
                    </button>
                </>

                {props.showSettingsButton ? (
                    <button
                        type="button"
                        aria-label={t('composer.settings')}
                        title={t('composer.settings')}
                        className="settings-button flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)]"
                        onClick={props.onSettingsToggle}
                        disabled={props.controlsDisabled}
                    >
                        <IconSettings style={iconSizeLg} />
                    </button>
                ) : null}

                {props.showTerminalButton ? (
                    <button
                        type="button"
                        aria-label={props.terminalLabel}
                        title={props.terminalLabel}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={props.onTerminal}
                        disabled={props.terminalDisabled}
                    >
                        <IconCommand style={iconSizeLg} />
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
                        {props.isAborting ? <IconLoading spin style={iconSizeLg} /> : <IconRecordStop style={iconSizeLg} />}
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
                        <IconMobile style={iconSizeLg} />
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
                        {props.voiceMicMuted ? <IconMute style={iconSizeLg} /> : <IconSound style={iconSizeLg} />}
                    </button>
                ) : null}
            </div>

            <UnifiedButton
                canSend={props.canSend}
                hasContent={props.hasContent}
                voiceStatus={props.voiceStatus}
                voiceEnabled={props.voiceEnabled}
                controlsDisabled={props.controlsDisabled}
                onSend={props.onSend}
                onEnqueue={props.onEnqueue}
                onVoiceToggle={props.onVoiceToggle}
            />
        </div>
    )
}
