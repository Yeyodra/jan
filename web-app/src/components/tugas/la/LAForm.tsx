import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTugasStore } from '@/hooks/useTugasStore'
import type { LAFormData } from '@/types/tugas'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface LAFormProps {
  onGenerate: (data: LAFormData) => void
}

export function LAForm({ onGenerate }: LAFormProps) {
  const { t } = useTranslation()
  const { matkul_lab } = useTugasStore()

  const [matkul, setMatkul] = useState('')
  const [modul, setModul] = useState(1)
  const [tanggal, setTanggal] = useState(() => new Date().toISOString().split('T')[0])
  const [materi, setMateri] = useState('')
  const [ketua_asisten, setKetuaAsisten] = useState('')
  const [kode_sumber, setKodeSumber] = useState('')
  const [screenshot_folder, setScreenshotFolder] = useState('')

  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [isPickingFile, setIsPickingFile] = useState(false)

  const matkulKeys = Object.keys(matkul_lab)

  const handleMatkulChange = (key: string) => {
    setMatkul(key)
    if (key && matkul_lab[key]) {
      setKetuaAsisten(matkul_lab[key].ketua_asisten)
    } else {
      setKetuaAsisten('')
    }
  }

  const handlePickScreenshotFolder = async () => {
    setIsPickingFolder(true)
    try {
      const result = await invoke<string | null>('open_dialog', {
        directory: true,
        multiple: false,
      })
      if (result) {
        setScreenshotFolder(result)
      }
    } finally {
      setIsPickingFolder(false)
    }
  }

  const handlePickSourceFile = async () => {
    setIsPickingFile(true)
    try {
      const result = await invoke<string | null>('open_dialog', {
        multiple: false,
      })
      if (result) {
        // Read file content via Tauri fs read_text_file
        const content = await invoke<string>('read_text_file', { path: result })
        setKodeSumber(content)
      }
    } finally {
      setIsPickingFile(false)
    }
  }

  const isGenerateDisabled = !matkul || !kode_sumber || !screenshot_folder

  const handleGenerate = () => {
    if (isGenerateDisabled) return
    onGenerate({
      matkul,
      modul,
      tanggal,
      materi,
      ketua_asisten,
      kode_sumber,
      screenshot_folder,
    })
  }

  return (
    <div className="space-y-4">
      {/* Matkul */}
      <div className="space-y-1.5">
        <Label htmlFor="la-matkul">{t('tugas:la.form.matkul')}</Label>
        <select
          id="la-matkul"
          value={matkul}
          onChange={(e) => handleMatkulChange(e.target.value)}
          className={cn(
            'border-input dark:bg-input/30 h-9 w-full min-w-0 rounded-md border bg-white px-3 py-1',
            'text-base text-foreground shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          <option value="">—</option>
          {matkulKeys.map((key) => (
            <option key={key} value={key}>
              {key} — {matkul_lab[key].full_name}
            </option>
          ))}
        </select>
      </div>

      {/* Modul */}
      <div className="space-y-1.5">
        <Label htmlFor="la-modul">{t('tugas:la.form.modul')}</Label>
        <Input
          id="la-modul"
          type="number"
          min={1}
          max={10}
          value={modul}
          onChange={(e) => setModul(Number(e.target.value))}
          className="w-32"
        />
      </div>

      {/* Tanggal */}
      <div className="space-y-1.5">
        <Label htmlFor="la-tanggal">{t('tugas:la.form.tanggal')}</Label>
        <Input
          id="la-tanggal"
          type="date"
          value={tanggal}
          onChange={(e) => setTanggal(e.target.value)}
          className="w-48"
        />
      </div>

      {/* Materi */}
      <div className="space-y-1.5">
        <Label htmlFor="la-materi">{t('tugas:la.form.materi')}</Label>
        <Input
          id="la-materi"
          value={materi}
          onChange={(e) => setMateri(e.target.value)}
        />
      </div>

      {/* Ketua Asisten */}
      <div className="space-y-1.5">
        <Label htmlFor="la-ketua">{t('tugas:la.form.ketuaAsisten')}</Label>
        <Input
          id="la-ketua"
          value={ketua_asisten}
          onChange={(e) => setKetuaAsisten(e.target.value)}
        />
      </div>

      {/* Kode Sumber */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="la-kode">{t('tugas:la.form.kodeSumber')}</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPickingFile}
            onClick={handlePickSourceFile}
          >
            {t('tugas:la.form.pilihFile')}
          </Button>
        </div>
        <Textarea
          id="la-kode"
          value={kode_sumber}
          onChange={(e) => setKodeSumber(e.target.value)}
          placeholder={t('tugas:la.form.kodeSumberPlaceholder')}
          rows={10}
          className="font-mono text-xs"
        />
      </div>

      {/* Screenshot Folder */}
      <div className="space-y-1.5">
        <Label>{t('tugas:la.form.screenshotFolder')}</Label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPickingFolder}
            onClick={handlePickScreenshotFolder}
          >
            {t('tugas:la.form.pilihFolder')}
          </Button>
          {screenshot_folder && (
            <span className="text-muted-foreground truncate text-xs" title={screenshot_folder}>
              {screenshot_folder}
            </span>
          )}
        </div>
      </div>

      {/* Generate */}
      <Button
        type="button"
        disabled={isGenerateDisabled}
        onClick={handleGenerate}
        className="w-full"
      >
        {t('tugas:la.form.generate')}
      </Button>
    </div>
  )
}

export default LAForm
