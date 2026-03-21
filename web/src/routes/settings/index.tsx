import { Select } from '@arco-design/web-react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { getElevenLabsSupportedLanguages, getLanguageDisplayName } from '@/lib/languages'
import { getFontScaleOptions, useFontScale, type FontScale } from '@/hooks/useFontScale'
import { getTerminalFontSizeOptions, useTerminalFontSize, type TerminalFontSize } from '@/hooks/useTerminalFontSize'
import { useAppearance, getAppearanceOptions, type AppearancePreference } from '@/hooks/useTheme'
import { PROTOCOL_VERSION } from '@hapi/protocol'
import { IconLeft } from '@arco-design/web-react/icon'
import { useState } from 'react'

const locales: { value: Locale; nativeLabel: string }[] = [
    { value: 'en', nativeLabel: 'English' },
    { value: 'zh-CN', nativeLabel: '简体中文' },
]

const voiceLanguages = getElevenLabsSupportedLanguages()

export default function SettingsPage() {
    const { t, locale, setLocale } = useTranslation()
    const goBack = useAppGoBack()
    const { fontScale, setFontScale } = useFontScale()
    const { terminalFontSize, setTerminalFontSize } = useTerminalFontSize()
    const { appearance, setAppearance } = useAppearance()

    const [voiceLanguage, setVoiceLanguage] = useState<string | null>(() => {
        return localStorage.getItem('hapi-voice-lang')
    })

    const fontScaleOptions = getFontScaleOptions()
    const terminalFontSizeOptions = getTerminalFontSizeOptions()
    const appearanceOptions = getAppearanceOptions()

    const handleVoiceLanguageChange = (code: string) => {
        const realCode = code === '__auto__' ? null : code
        setVoiceLanguage(realCode)
        if (realCode === null) {
            localStorage.removeItem('hapi-voice-lang')
        } else {
            localStorage.setItem('hapi-voice-lang', realCode)
        }
    }

    return (
        <div className="flex h-full flex-col">
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <IconLeft style={{ fontSize: 20 }} />
                    </button>
                    <div className="flex-1 font-semibold">{t('settings.title')}</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content">
                    {/* Language section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.language.title')}
                        </div>
                        <SettingsRow label={t('settings.language.label')}>
                            <Select
                                value={locale}
                                onChange={(val: string) => setLocale(val as Locale)}
                                size="small"
                                getPopupContainer={(node) => node.parentElement ?? document.body}
                            >
                                {locales.map((loc) => (
                                    <Select.Option key={loc.value} value={loc.value}>{loc.nativeLabel}</Select.Option>
                                ))}
                            </Select>
                        </SettingsRow>
                    </div>

                    {/* Display section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.display.title')}
                        </div>
                        <SettingsRow label={t('settings.display.appearance')}>
                            <Select
                                value={appearance}
                                onChange={(val: string) => setAppearance(val as AppearancePreference)}
                                size="small"
                                getPopupContainer={(node) => node.parentElement ?? document.body}
                            >
                                {appearanceOptions.map((opt) => (
                                    <Select.Option key={opt.value} value={opt.value}>{t(opt.labelKey)}</Select.Option>
                                ))}
                            </Select>
                        </SettingsRow>
                        <SettingsRow label={t('settings.display.fontSize')}>
                            <Select
                                value={fontScale}
                                onChange={(val: string) => setFontScale(val as FontScale)}
                                size="small"
                                getPopupContainer={(node) => node.parentElement ?? document.body}
                            >
                                {fontScaleOptions.map((opt) => (
                                    <Select.Option key={opt.value} value={opt.value}>{opt.label}</Select.Option>
                                ))}
                            </Select>
                        </SettingsRow>
                        <SettingsRow label={t('settings.display.terminalFontSize')}>
                            <Select
                                value={terminalFontSize}
                                onChange={(val: string) => setTerminalFontSize(val as TerminalFontSize)}
                                size="small"
                                getPopupContainer={(node) => node.parentElement ?? document.body}
                            >
                                {terminalFontSizeOptions.map((opt) => (
                                    <Select.Option key={opt.value} value={opt.value}>{opt.label}</Select.Option>
                                ))}
                            </Select>
                        </SettingsRow>
                    </div>

                    {/* Voice Assistant section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.voice.title')}
                        </div>
                        <SettingsRow label={t('settings.voice.language')}>
                            <Select
                                value={voiceLanguage ?? '__auto__'}
                                onChange={handleVoiceLanguageChange}
                                size="small"
                                showSearch
                                getPopupContainer={(node) => node.parentElement ?? document.body}
                            >
                                {voiceLanguages.map((lang) => (
                                    <Select.Option key={lang.code ?? '__auto__'} value={lang.code ?? '__auto__'}>
                                        {lang.code === null ? t('settings.voice.autoDetect') : getLanguageDisplayName(lang)}
                                    </Select.Option>
                                ))}
                            </Select>
                        </SettingsRow>
                    </div>

                    {/* About section */}
                    <div className="border-b border-[var(--app-divider)]">
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                            {t('settings.about.title')}
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">{t('settings.about.website')}</span>
                            <a
                                href="https://hapi.run"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--app-link)] hover:underline"
                            >
                                hapi.run
                            </a>
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">{t('settings.about.appVersion')}</span>
                            <span className="text-[var(--app-hint)]">0.16.2-Base</span>
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">二次开发</span>
                            <a
                                href="https://github.com/Hwwwww-dev/hapi"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--app-link)] hover:underline"
                            >
                                Hwwwww
                            </a>
                        </div>
                        <div className="flex w-full items-center justify-between px-3 py-3">
                            <span className="text-[var(--app-fg)]">{t('settings.about.protocolVersion')}</span>
                            <span className="text-[var(--app-hint)]">{PROTOCOL_VERSION}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="relative flex w-full items-center justify-between px-3 py-3">
            <span className="text-[var(--app-fg)] shrink-0 mr-3">{label}</span>
            <div className="shrink-0 min-w-[200px]">
                {children}
            </div>
        </div>
    )
}
