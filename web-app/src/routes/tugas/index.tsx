import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTugasStore } from '@/hooks/useTugasStore'
import HeaderPage from '@/containers/HeaderPage'

export const Route = createFileRoute(route.tugas.index as any)({
  component: TugasDashboard,
})

function TugasDashboard() {
  const { t } = useTranslation()
  const { isConfigured } = useTugasStore()
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">{t('tugas:dashboard.heading')}</span>
        </div>
      </HeaderPage>
      <div className="flex-1 p-6">
        {/* Not configured banner */}
        {!isConfigured && (
          <div className="mb-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm">
            <p className="text-yellow-600 dark:text-yellow-400">
              Konfigurasi Tugas System belum lengkap.{' '}
              <button
                className="underline"
                onClick={() => navigate({ to: route.settings.tugas as any })}
              >
                Buka Settings
              </button>
            </p>
          </div>
        )}

        {/* LA Generator Card */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <button
            className="p-6 rounded-xl border border-border bg-card hover:bg-accent transition-colors text-left"
            onClick={() => navigate({ to: route.tugas.la as any })}
          >
            <h3 className="font-semibold text-base mb-1">{t('tugas:dashboard.laCard.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('tugas:dashboard.laCard.description')}</p>
          </button>
        </div>
      </div>
    </div>
  )
}
