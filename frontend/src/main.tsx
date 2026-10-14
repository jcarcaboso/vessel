import { PageErrorBoundary } from '@/components/PageErrorBoundary'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { initAppearance } from '@/features/settings/appearance'
import '@fontsource-variable/inter'
import './styles.css'

initAppearance()
// Boundary fallbacks are fixed text. Never log thrown messages or component stacks that may contain private data.
createRoot(document.getElementById('root')!, { onCaughtError: () => {}, onUncaughtError: () => {}, onRecoverableError: () => {} })
  .render(<StrictMode><PageErrorBoundary><WorkspacePage /></PageErrorBoundary></StrictMode>)
