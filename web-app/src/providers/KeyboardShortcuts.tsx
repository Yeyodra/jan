import { useKeyboardShortcut } from '@/hooks/useHotkeys'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useSearchDialog } from '@/hooks/useSearchDialog'
import { useProjectDialog } from '@/hooks/useProjectDialog'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { PlatformShortcuts, ShortcutAction } from '@/lib/shortcuts'
import { useAgentMode } from '@/hooks/useAgentMode'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

/**
 * Returns true when the user is currently typing into an editable surface.
 * Used to skip *navigational* global shortcuts so they don't steal keystrokes
 * from chat/search/rename inputs (T23 negative scenario).
 */
function isTypingInEditableElement(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

export function KeyboardShortcutsProvider() {
  const { open, setLeftPanel } = useLeftPanel()
  const { setOpen: setSearchOpen } = useSearchDialog()
  const { setOpen: setProjectDialogOpen } = useProjectDialog()
  const router = useRouter()

  // Get shortcut specs from centralized configuration
  const sidebarShortcut = PlatformShortcuts[ShortcutAction.TOGGLE_SIDEBAR]
  const newChatShortcut = PlatformShortcuts[ShortcutAction.NEW_CHAT]
  const newProjectShortcut = PlatformShortcuts[ShortcutAction.NEW_PROJECT]
  const settingsShortcut = PlatformShortcuts[ShortcutAction.GO_TO_SETTINGS]
  const searchShortcut = PlatformShortcuts[ShortcutAction.SEARCH]
  const canvasShortcut = PlatformShortcuts[ShortcutAction.GO_TO_CANVAS]

  // Toggle Sidebar
  useKeyboardShortcut({
    ...sidebarShortcut,
    callback: () => {
      setLeftPanel(!open)
    },
  })

  // New Chat
  useKeyboardShortcut({
    ...newChatShortcut,
    callback: () => {
      useAgentMode.getState().removeThread(TEMPORARY_CHAT_ID)
      router.navigate({ to: route.home })
    },
  })

  // New Agent Chat — disabled, kept as dead code for future use
  // useKeyboardShortcut({
  //   ...newAgentChatShortcut,
  //   callback: () => {
  //     useAgentMode.getState().setAgentMode(TEMPORARY_CHAT_ID, true)
  //     router.navigate({ to: route.home })
  //   },
  // })

  // New Project
  useKeyboardShortcut({
    ...newProjectShortcut,
    callback: () => {
      setProjectDialogOpen(true)
    },
  })

  // Go to Settings
  useKeyboardShortcut({
    ...settingsShortcut,
    callback: () => {
      router.navigate({ to: route.settings.general })
    },
  })

  // Search
  useKeyboardShortcut({
    ...searchShortcut,
    callback: () => {
      setSearchOpen(true)
    },
  })

  // Go to Canvas — Ctrl/Cmd+Shift+C. Skip while the user is typing in an
  // editable element so the shortcut doesn't steal keystrokes from chat /
  // search / rename inputs.
  useKeyboardShortcut({
    ...canvasShortcut,
    callback: () => {
      if (isTypingInEditableElement()) return
      router.navigate({ to: route.canvas })
    },
  })

  // This component doesn't render anything
  return null
}
