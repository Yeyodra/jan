import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconPlus, IconX, IconCheck } from '@tabler/icons-react'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn, getProviderTitle, getModelDisplayName } from '@/lib/utils'

export type SelectedModel = {
  providerId: string
  modelId: string
}

export interface ModelMultiSelectorProps {
  selectedModels: SelectedModel[]
  onAdd: (provider: ModelProvider, modelId: string) => void
  onRemove: (providerId: string, modelId: string) => void
  disabled?: boolean
}

const MIN_MODELS = 2
const MAX_MODELS = 6

function ModelMultiSelector({
  selectedModels,
  onAdd,
  onRemove,
  disabled = false,
}: ModelMultiSelectorProps) {
  const { t } = useTranslation('compare')
  const providers = useModelProvider((s) => s.providers)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const atMax = selectedModels.length >= MAX_MODELS
  const belowMin = selectedModels.length < MIN_MODELS

  const isSelectedPair = (providerId: string, modelId: string) =>
    selectedModels.some(
      (sm) => sm.providerId === providerId && sm.modelId === modelId
    )

  const visibleProviders = useMemo(() => {
    const q = query.trim().toLowerCase()
    return providers
      .filter((p) => p.active !== false)
      .map((p) => {
        const models = (p.models ?? []).filter((m) => {
          if (m.embedding) return false
          if (!q) return true
          const haystack = [
            m.id,
            m.name,
            m.displayName,
            p.provider,
            getProviderTitle(p.provider),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          return haystack.includes(q)
        })
        return { provider: p, models }
      })
      .filter((entry) => entry.models.length > 0)
  }, [providers, query])

  const tryAdd = (provider: ModelProvider, modelId: string) => {
    if (disabled) return
    if (selectedModels.length >= MAX_MODELS) return
    if (isSelectedPair(provider.provider, modelId)) {
      toast.error(t('duplicateModelToast'))
      return
    }
    onAdd(provider, modelId)
  }

  return (
    <div
      className="space-y-2"
      aria-disabled={disabled || undefined}
      data-disabled={disabled || undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        {selectedModels.map((sm) => {
          const provider = providers.find((p) => p.provider === sm.providerId)
          const modelObj = provider?.models?.find((m) => m.id === sm.modelId)
          const label = modelObj ? getModelDisplayName(modelObj) : sm.modelId
          return (
            <div
              key={`${sm.providerId}:${sm.modelId}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border bg-secondary/60 pl-1.5 pr-1 py-1 text-xs',
                disabled && 'opacity-60'
              )}
            >
              {provider ? (
                <ProvidersAvatar provider={provider} />
              ) : (
                <span className="size-4.5 rounded-full border" />
              )}
              <span className="max-w-[160px] truncate font-medium">
                {label}
              </span>
              <button
                type="button"
                aria-label={t('removeColumn')}
                onClick={() => {
                  if (disabled) return
                  onRemove(sm.providerId, sm.modelId)
                }}
                disabled={disabled}
                className={cn(
                  'inline-flex size-5 items-center justify-center rounded-full text-muted-foreground',
                  'hover:bg-foreground/10 hover:text-foreground',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                <IconX className="size-3" />
              </button>
            </div>
          )
        })}

        <Popover
          open={open && !disabled && !atMax}
          onOpenChange={(next) => {
            if (disabled || atMax) {
              setOpen(false)
              return
            }
            setOpen(next)
            if (!next) setQuery('')
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || atMax}
              aria-disabled={disabled || atMax || undefined}
              aria-label={t('selectModels')}
            >
              <IconPlus className="size-4" />
              <span>{t('selectModels')}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80 p-0"
            onOpenAutoFocus={(e) => {
              // Focus search input on open
              const input = (e.currentTarget as HTMLElement)?.querySelector(
                'input[data-slot="multi-selector-search"]'
              ) as HTMLInputElement | null
              if (input) {
                e.preventDefault()
                input.focus()
              }
            }}
          >
            <div className="border-b p-2">
              <Input
                data-slot="multi-selector-search"
                placeholder={t('selectModels')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8"
                aria-label={t('selectModels')}
              />
            </div>
            <div
              className="max-h-72 overflow-y-auto py-1"
              role="listbox"
              aria-multiselectable="true"
            >
              {visibleProviders.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  —
                </div>
              ) : (
                visibleProviders.map(({ provider, models }) => (
                  <div key={provider.provider} className="py-1">
                    <div className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {getProviderTitle(provider.provider)}
                    </div>
                    {models.map((m) => {
                      const selected = isSelectedPair(provider.provider, m.id)
                      const reachedMax = atMax && !selected
                      return (
                        <button
                          key={`${provider.provider}:${m.id}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={selected || reachedMax}
                          onClick={() => {
                            tryAdd(provider, m.id)
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                            'hover:bg-accent hover:text-accent-foreground',
                            'disabled:cursor-not-allowed disabled:opacity-50',
                            selected && 'bg-secondary/60'
                          )}
                        >
                          <ProvidersAvatar provider={provider} />
                          <span className="flex-1 truncate">
                            {getModelDisplayName(m)}
                          </span>
                          {selected && (
                            <IconCheck className="size-4 text-muted-foreground" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
              <span>
                {selectedModels.length}/{MAX_MODELS}
              </span>
              {atMax && <span>{`max ${MAX_MODELS}`}</span>}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {belowMin && (
        <p
          className="text-xs text-muted-foreground"
          aria-live="polite"
          role="status"
        >
          {t('minModelsHint')}
        </p>
      )}
    </div>
  )
}

export default ModelMultiSelector
export { ModelMultiSelector }
