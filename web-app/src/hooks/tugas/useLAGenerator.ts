import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { resolveResource } from '@tauri-apps/api/path'
import { useThreads } from '@/hooks/useThreads'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useTugasStore } from '@/hooks/useTugasStore'
import { TUGAS_OUTPUT_SUBFOLDER, TUGAS_LATEX_RESOURCES_PATH } from '@/constants/tugas'
import type { LAFormData } from '@/types/tugas'

// State returned by this hook
type LAGeneratorState = {
  status: 'idle' | 'generating' | 'error'
  threadId?: string
  outputFolder?: string
  /** The initial LA prompt to send as the first user message in the thread. */
  initialPrompt?: string
  error?: string
}

type UseLAGeneratorReturn = LAGeneratorState & {
  generate: (data: LAFormData) => Promise<void>
}

// LaTeX asset filenames bundled in src-tauri/resources/tugas/latex/
const LATEX_ASSETS = ['gunadarma-la.cls', 'logo-gunadarma.png'] as const

/**
 * Copies a bundled LaTeX resource file to the output folder.
 * Strategy: resolveResource → read_file_sync → write_file_sync
 * (No native copy_file Tauri command exists in this codebase.)
 */
async function copyLatexAsset(filename: string, outputFolder: string): Promise<void> {
  // Resolve the bundled resource path (works in both dev and prod)
  const resourcePath = await resolveResource(
    `${TUGAS_LATEX_RESOURCES_PATH}/latex/${filename}`
  )

  // Read content from bundled resource
  const content = await invoke<string>('read_file_sync', { args: [resourcePath] })

  // Write to output folder
  const destPath = `${outputFolder}/${filename}`
  await invoke<void>('write_file_sync', { args: [destPath, content] })
}

/**
 * Builds the LA prompt string from form data and store settings.
 */
function buildLAPrompt(
  data: LAFormData,
  settings: {
    nama: string
    npm: string
    kelas: string
    semester: string
    tahun_ajaran: string
    matkulFullName: string
    outputFolder: string
  }
): string {
  const { nama, npm, kelas, semester, tahun_ajaran, matkulFullName, outputFolder } = settings

  return `Kamu adalah asisten yang membantu menulis Laporan Akhir (LA) format Universitas Gunadarma.

## Identitas Mahasiswa
- Nama: ${nama}
- NPM: ${npm}
- Kelas: ${kelas}
- Semester: ${semester} — ${tahun_ajaran}

## Informasi Praktikum
- Mata Kuliah: ${matkulFullName}
- Modul: ${data.modul}
- Tanggal: ${data.tanggal}
- Materi: ${data.materi}
- Ketua Asisten: ${data.ketua_asisten}

## Kode Sumber
\`\`\`
${data.kode_sumber}
\`\`\`

## Folder Screenshot
${data.screenshot_folder}

## Instruksi
Buatkan file LaTeX lengkap untuk LA ini menggunakan class \`gunadarma-la.cls\`.
Output harus berupa file .tex yang valid dan bisa di-compile dengan pdflatex.
Simpan file ke: ${outputFolder}/laporan.tex

Ikuti format standar Gunadarma: cover, lembar pengesahan, pendahuluan, landasan teori, pembahasan, kesimpulan.`
}

export function useLAGenerator(): UseLAGeneratorReturn {
  const navigate = useNavigate()

  const [state, setState] = useState<LAGeneratorState>({ status: 'idle' })

  const generate = useCallback(async (data: LAFormData) => {
    // Read store state (zustand .getState() for async context outside render)
    const { nama, npm, kelas, semester, tahun_ajaran, base_path, matkul_lab } =
      useTugasStore.getState()

    const { selectedModel, selectedProvider } = useModelProvider.getState()

    // Resolve matkul entry
    const matkulEntry = matkul_lab[data.matkul]
    if (!matkulEntry) {
      setState({ status: 'error', error: `Unknown matkul key: ${data.matkul}` })
      return
    }

    // Build output folder path
    const outputFolder = `${base_path}/LAB/${data.matkul}/M${data.modul}/${TUGAS_OUTPUT_SUBFOLDER}`

    setState({ status: 'generating' })

    try {
      // 1. Create output directory (create_dir_all equivalent via mkdir Tauri command)
      await invoke<void>('mkdir', { args: [outputFolder] })

      // 2. Build thread model from selected model + provider
      const threadModel: ThreadModel = {
        id: selectedModel?.id ?? 'default',
        provider: selectedProvider ?? 'llamacpp',
      }

      // 3. Create Jan thread — title format: "LA {matkul_full_name} Modul {N}"
      const threadTitle = `LA ${matkulEntry.full_name} Modul ${data.modul}`
      const thread = await useThreads.getState().createThread(threadModel, threadTitle)

      // 4. Navigate to the new thread
      navigate({ to: `/threads/${thread.id}` })

      // 5. Copy LaTeX template assets to output folder (best-effort, non-blocking errors logged)
      for (const asset of LATEX_ASSETS) {
        try {
          await copyLatexAsset(asset, outputFolder)
        } catch (assetErr) {
          console.warn(`[useLAGenerator] Failed to copy asset ${asset}:`, assetErr)
        }
      }

      // 6. Build the initial LA prompt and update state
      const initialPrompt = buildLAPrompt(data, {
        nama,
        npm,
        kelas,
        semester,
        tahun_ajaran,
        matkulFullName: matkulEntry.full_name,
        outputFolder,
      })

      setState({
        status: 'generating',
        threadId: thread.id,
        outputFolder,
        initialPrompt,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState({ status: 'error', error: message })
      // Do NOT navigate on error
    }
  }, [navigate])

  return {
    ...state,
    generate,
  }
}
