export type MatkulLabEntry = {
  full_name: string
  path: string
  ketua_asisten: string
}

export type TugasSettings = {
  semester: string
  tahun_ajaran: string
  kelas: string
  nama: string
  npm: string
  base_path: string
  matkul_lab: Record<string, MatkulLabEntry>
  isConfigured: boolean
}

export type LAGenerateResult = {
  threadId: string
  texContent: string
  texFilePath: string
  outputPdfPath?: string
  status: 'idle' | 'generating' | 'tex-ready' | 'compiled' | 'error'
  error?: string
}

export type LAFormData = {
  matkul: string // key from matkul_lab (e.g., 'PC', 'PTTG', 'RK', 'SBD2', 'TBO')
  modul: number // 1-10
  tanggal: string // ISO date string
  materi: string // optional, can be inferred
  ketua_asisten: string // pre-filled from store
  kode_sumber: string // pasted source code
  screenshot_folder: string // absolute path to folder containing screenshots
}

export type CompileStatus =
  | 'idle'
  | 'checking'
  | 'miktex-absent'
  | 'installing'
  | 'compiling'
  | 'done'
  | 'error'

export type MikTexInstallStatus = {
  status: 'idle' | 'downloading' | 'installing' | 'done' | 'error'
  progress: number // 0-100
  error?: string
}
