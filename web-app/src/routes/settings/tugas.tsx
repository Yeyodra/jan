import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTugasStore } from '@/hooks/useTugasStore'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.tugas as any)({
  component: TugasSettings,
})

function TugasSettings() {
  const { t } = useTranslation()
  const {
    nama,
    npm,
    kelas,
    semester,
    tahun_ajaran,
    base_path,
    matkul_lab,
    updateSettings,
  } = useTugasStore()

  const [isPickingFolder, setIsPickingFolder] = useState(false)

  const handlePickFolder = async () => {
    setIsPickingFolder(true)
    try {
      const result = await invoke<string | null>('open_dialog', {
        directory: true,
        multiple: false,
      })
      if (result) {
        updateSettings({ base_path: result })
      }
    } finally {
      setIsPickingFolder(false)
    }
  }

  const handleSave = () => {
    updateSettings({ isConfigured: true })
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">{t('tugas:settings.title')}</span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
        <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
          {/* Section 1: Informasi Mahasiswa */}
          <Card title={t('tugas:settings.informasiMahasiswa')}>
            <CardItem
              title={t('tugas:settings.nama')}
              actions={
                <Input
                  value={nama}
                  onChange={(e) => updateSettings({ nama: e.target.value })}
                  className="w-48"
                />
              }
            />
            <CardItem
              title={t('tugas:settings.npm')}
              actions={
                <Input
                  value={npm}
                  onChange={(e) => updateSettings({ npm: e.target.value })}
                  className="w-48"
                />
              }
            />
            <CardItem
              title={t('tugas:settings.kelas')}
              actions={
                <Input
                  value={kelas}
                  onChange={(e) => updateSettings({ kelas: e.target.value })}
                  className="w-48"
                />
              }
            />
          </Card>

          {/* Section 2: Konfigurasi Semester */}
          <Card title={t('tugas:settings.konfigurasiSemester')}>
            <CardItem
              title={t('tugas:settings.semester')}
              actions={
                <Input
                  value={semester}
                  onChange={(e) => updateSettings({ semester: e.target.value })}
                  className="w-48"
                />
              }
            />
            <CardItem
              title={t('tugas:settings.tahunAjaran')}
              actions={
                <Input
                  value={tahun_ajaran}
                  onChange={(e) =>
                    updateSettings({ tahun_ajaran: e.target.value })
                  }
                  className="w-48"
                />
              }
            />
            <CardItem
              title={t('tugas:settings.basePath')}
              align="start"
              column
              actions={
                <div className="flex items-center gap-2 w-full mt-1">
                  <Input
                    value={base_path}
                    readOnly
                    placeholder="/path/to/folder"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    onClick={handlePickFolder}
                    disabled={isPickingFolder}
                  >
                    {t('tugas:settings.pilihFolder')}
                  </Button>
                </div>
              }
            />
          </Card>

          {/* Section 3: Mata Kuliah Lab */}
          <Card title={t('tugas:settings.matkulLab')}>
            {Object.entries(matkul_lab).map(([key, entry]) => (
              <CardItem
                key={key}
                title={
                  <span>
                    <span className="font-semibold">{key}</span>
                    <span className="text-muted-foreground font-normal ml-2">
                      {entry.full_name}
                    </span>
                  </span>
                }
                description={t('tugas:settings.ketuaAsisten')}
                actions={
                  <Input
                    value={entry.ketua_asisten}
                    onChange={(e) =>
                      updateSettings({
                        matkul_lab: {
                          ...matkul_lab,
                          [key]: {
                            ...entry,
                            ketua_asisten: e.target.value,
                          },
                        },
                      })
                    }
                    className="w-48"
                    placeholder="Nama Ketua Asisten"
                  />
                }
              />
            ))}
          </Card>

          {/* Save */}
          <div className="flex justify-end">
            <Button onClick={handleSave}>{t('tugas:settings.save')}</Button>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
