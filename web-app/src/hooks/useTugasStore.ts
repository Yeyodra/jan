import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import type { TugasSettings, MatkulLabEntry } from '@/types/tugas'

const DEFAULT_MATKUL_LAB: Record<string, MatkulLabEntry> = {
  PC: {
    full_name: 'Pengolahan Citra',
    path: 'LAB/PC',
    ketua_asisten: '',
  },
  PTTG: {
    full_name: 'Terapan Teori Graf',
    path: 'LAB/PTTG',
    ketua_asisten: '',
  },
  RK: {
    full_name: 'Rekayasa Komputasional',
    path: 'LAB/RK',
    ketua_asisten: '',
  },
  SBD2: {
    full_name: 'Sistem Basis Data 2',
    path: 'LAB/SBD2',
    ketua_asisten: '',
  },
  TBO: {
    full_name: 'Teori Bahasa dan Otomata',
    path: 'LAB/TBO',
    ketua_asisten: '',
  },
}

const DEFAULT_SETTINGS: Omit<TugasSettings, 'updateSettings' | 'resetSettings'> = {
  semester: 'S6',
  tahun_ajaran: '2025/2026 Genap',
  kelas: '3IA21',
  nama: '',
  npm: '',
  base_path: '',
  matkul_lab: DEFAULT_MATKUL_LAB,
  isConfigured: false,
}

type TugasStoreState = TugasSettings & {
  updateSettings: (partial: Partial<TugasSettings>) => void
  resetSettings: () => void
}

export const useTugasStore = create<TugasStoreState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      updateSettings: (partial) => set((state) => ({ ...state, ...partial })),
      resetSettings: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: localStorageKey.tugasSettings,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
