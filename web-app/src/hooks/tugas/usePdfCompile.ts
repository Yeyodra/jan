import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TUGAS_PDFLATEX_CMD, TUGAS_MIKTEX_INSTALLER_URL } from '@/constants/tugas'
import type { CompileStatus } from '@/types/tugas'

// ─── Types ────────────────────────────────────────────────────────────────────

export type { CompileStatus }

type PdfCompileState = {
  status: CompileStatus
  progress: number
  outputPdfPath?: string
  error?: string
}

type UsePdfCompileReturn = PdfCompileState & {
  checkPdflatex: () => Promise<boolean>
  installMiKTeX: () => Promise<void>
  compile: (texFilePath: string) => Promise<void>
  reset: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the directory from an absolute file path.
 * Works with both forward slashes and Windows backslashes.
 */
function dirnameOf(filePath: string): string {
  // Normalise separators → forward slash
  const normalised = filePath.replace(/\\/g, '/')
  const lastSlash = normalised.lastIndexOf('/')
  return lastSlash >= 0 ? filePath.slice(0, lastSlash) : '.'
}

/**
 * Derive the expected output PDF path from a .tex file path.
 * pdflatex writes {filename-without-ext}.pdf into -output-directory.
 */
function pdfPathFrom(texFilePath: string): string {
  const normalised = texFilePath.replace(/\\/g, '/')
  const lastSlash = normalised.lastIndexOf('/')
  const filename = lastSlash >= 0 ? normalised.slice(lastSlash + 1) : normalised
  const basename = filename.endsWith('.tex') ? filename.slice(0, -4) : filename
  const dir = dirnameOf(texFilePath)
  const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : '/'
  return `${dir}${sep}${basename}.pdf`
}

// ─── Invoke wrappers ──────────────────────────────────────────────────────────

/**
 * Run a command via the Tauri backend and capture stdout + exit code.
 *
 * Rust command: `tugas_run_command`
 * Signature:  run_command(program: &str, args: Vec<&str>) -> Result<CommandOutput, String>
 * CommandOutput: { stdout: String, stderr: String, exit_code: i32 }
 *
 * Follows the same pattern as `check_jan_cli_installed` which calls
 * std::process::Command::new("where").arg("jan") internally.
 */
async function runCommand(program: string, args: string[]): Promise<{
  stdout: string
  stderr: string
  exit_code: number
}> {
  return invoke<{ stdout: string; stderr: string; exit_code: number }>(
    'tugas_run_command',
    { program, args },
  )
}

/**
 * Download a file via the existing Tauri download_files command.
 *
 * `save_path` is resolved relative to the jan data folder
 * (see resolve_path_within_jan_data_folder in Rust).
 * We use a dedicated temp subfolder so the installer is easy to locate.
 *
 * Progress events are emitted by the Rust side on the channel
 * `download://{task_id}` — we poll by waiting for the command to resolve
 * and approximate progress linearly for UX purposes.
 */
async function downloadFile(
  url: string,
  savePath: string,
  taskId: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  // Simulate incremental progress while the blocking download resolves.
  // The real download is happening in Rust — this keeps the UI responsive.
  let simulatedPct = 0
  const ticker = setInterval(() => {
    // Advance up to 90 % — the last 10 % is set on completion.
    if (simulatedPct < 90) {
      simulatedPct += 2
      onProgress(simulatedPct)
    }
  }, 600)

  try {
    await invoke<void>('download_files', {
      items: [{ url, save_path: savePath }],
      taskId,
      headers: {},
    })
    onProgress(100)
  } finally {
    clearInterval(ticker)
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const INITIAL_STATE: PdfCompileState = {
  status: 'idle',
  progress: 0,
}

/**
 * usePdfCompile — check pdflatex availability, silently install MiKTeX if
 * absent, and compile a .tex file to PDF.
 *
 * State shape:
 *   status: CompileStatus
 *   progress: 0–100  (meaningful during 'installing' and 'compiling')
 *   outputPdfPath: set when status === 'done'
 *   error: set when status === 'error'
 *
 * Tauri commands required on the Rust side:
 *   - tugas_run_command(program, args) → { stdout, stderr, exit_code }
 *   - download_files(items, task_id, headers) → void   (already registered)
 */
export function usePdfCompile(): UsePdfCompileReturn {
  const [state, setState] = useState<PdfCompileState>(INITIAL_STATE)

  // ── checkPdflatex ────────────────────────────────────────────────────────

  /**
   * Run `where pdflatex` (Windows) to test if pdflatex is on PATH.
   * Sets status to 'miktex-absent' when not found.
   * Returns true when pdflatex is available.
   */
  const checkPdflatex = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, status: 'checking', progress: 0 }))

    try {
      // `where` is the Windows equivalent of `which` — same approach used
      // by check_jan_cli_installed in src-tauri/src/core/system/commands.rs
      const result = await runCommand('where', [TUGAS_PDFLATEX_CMD])
      const found = result.exit_code === 0 && result.stdout.trim().length > 0

      if (found) {
        setState((prev) => ({ ...prev, status: 'idle' }))
      } else {
        setState((prev) => ({ ...prev, status: 'miktex-absent' }))
      }

      return found
    } catch (err) {
      // `where` itself failing (not found on system) means pdflatex is absent
      setState((prev) => ({ ...prev, status: 'miktex-absent' }))
      return false
    }
  }, [])

  // ── installMiKTeX ────────────────────────────────────────────────────────

  /**
   * Download the MiKTeX basic installer and run it with --unattended --shared=yes.
   *
   * Progress (0–100) is updated throughout:
   *   0–60  → download phase
   *   60–95 → installer execution (simulated; no stdout from silent install)
   *   100   → complete, status back to 'idle' so caller can proceed to compile
   */
  const installMiKTeX = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, status: 'installing', progress: 0 }))

    // Installer is saved into a dedicated tugas temp subfolder inside the
    // jan data directory (resolved server-side by resolve_path_within_jan_data_folder).
    const installerSavePath = 'tugas/miktex-installer.exe'
    const taskId = `miktex-install-${Date.now()}`

    try {
      // Phase 1: Download (0–60 %)
      await downloadFile(
        TUGAS_MIKTEX_INSTALLER_URL,
        installerSavePath,
        taskId,
        (pct) => setState((prev) => ({
          ...prev,
          status: 'installing',
          progress: Math.round(pct * 0.6), // scale to 0–60 range
        })),
      )

      setState((prev) => ({ ...prev, progress: 60 }))

      // Phase 2: Silent install (60–95 %, simulated progress during blocking call)
      let installPct = 60
      const installTicker = setInterval(() => {
        if (installPct < 94) {
          installPct += 2
          setState((prev) => ({ ...prev, status: 'installing', progress: installPct }))
        }
      }, 800)

      try {
        // --unattended skips UI; --shared=yes installs for all users
        // The path to the installer is resolved by Rust from the jan data folder.
        await runCommand('tugas_run_installer_from_data_folder', [
          installerSavePath,
          '--unattended',
          '--shared=yes',
        ])
      } finally {
        clearInterval(installTicker)
      }

      setState((prev) => ({ ...prev, status: 'idle', progress: 100 }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: `MiKTeX install failed: ${message}`,
      }))
      throw err
    }
  }, [])

  // ── compile ──────────────────────────────────────────────────────────────

  /**
   * Compile a .tex file to PDF using pdflatex.
   *
   * Runs: pdflatex -interaction=nonstopmode -output-directory={dir} {texFilePath}
   * On success: status → 'done', outputPdfPath → {dir}/{name}.pdf
   * On failure: status → 'error', error contains pdflatex stderr/stdout tail
   */
  const compile = useCallback(async (texFilePath: string): Promise<void> => {
    setState((prev) => ({ ...prev, status: 'compiling', progress: 0, error: undefined }))

    const outputDir = dirnameOf(texFilePath)
    const expectedPdf = pdfPathFrom(texFilePath)

    // Simulate progress while pdflatex runs (it produces no structured progress)
    let compilePct = 0
    const compileTicker = setInterval(() => {
      if (compilePct < 90) {
        compilePct += 5
        setState((prev) => ({ ...prev, status: 'compiling', progress: compilePct }))
      }
    }, 400)

    try {
      const result = await runCommand(TUGAS_PDFLATEX_CMD, [
        '-interaction=nonstopmode',
        `-output-directory=${outputDir}`,
        texFilePath,
      ])

      clearInterval(compileTicker)

      if (result.exit_code !== 0) {
        // Capture the last 20 lines of output for diagnostics
        const outputLines = (result.stdout + '\n' + result.stderr)
          .trim()
          .split('\n')
        const tail = outputLines.slice(-20).join('\n')

        setState((prev) => ({
          ...prev,
          status: 'error',
          progress: 0,
          error: `pdflatex exited with code ${result.exit_code}:\n${tail}`,
        }))
        return
      }

      setState({
        status: 'done',
        progress: 100,
        outputPdfPath: expectedPdf,
        error: undefined,
      })
    } catch (err) {
      clearInterval(compileTicker)
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({
        ...prev,
        status: 'error',
        progress: 0,
        error: `compile error: ${message}`,
      }))
      throw err
    }
  }, [])

  // ── reset ────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return {
    ...state,
    checkPdflatex,
    installMiKTeX,
    compile,
    reset,
  }
}
