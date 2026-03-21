import { useTranslation, type Locale } from '@/lib/use-translation'
import { Dropdown, Menu } from '@arco-design/web-react'
import { IconLanguage, IconCheck } from '@arco-design/web-react/icon'

const locales: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
]

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation()

  const dropdownMenu = (
    <Menu onClickMenuItem={(key) => setLocale(key as Locale)} selectedKeys={[locale]}>
      {locales.map((loc) => (
        <Menu.Item key={loc.value}>
          <div className="flex items-center justify-between w-full">
            <span>{loc.label}</span>
            {locale === loc.value && <IconCheck className="text-[var(--app-link)]" style={{ fontSize: 14 }} />}
          </div>
        </Menu.Item>
      ))}
    </Menu>
  )

  return (
    <Dropdown droplist={dropdownMenu} trigger="click" position="br">
      <button
        type="button"
        className="flex items-center justify-center h-8 w-8 rounded-md text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
        title={t('language.title')}
        aria-label={t('language.title')}
      >
        <IconLanguage style={{ fontSize: 18 }} />
      </button>
    </Dropdown>
  )
}
