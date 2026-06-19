import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import { cn } from '@/lib/utils'

// ─── Props ────────────────────────────────────────────────────────────────────

interface TugasHeaderProps {
  /** Page title shown after the "Tugas >" breadcrumb */
  pageTitle: string
  className?: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TugasHeader({ pageTitle, className }: TugasHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <HeaderPage>
      <div className={cn('flex items-center gap-1.5 text-sm', className)}>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => navigate({ to: route.tugas.index as any })}
        >
          {t('tugas:title')}
        </button>
        <span className="text-muted-foreground/50" aria-hidden="true">/</span>
        <span className="font-medium text-foreground">{pageTitle}</span>
      </div>
    </HeaderPage>
  )
}
