import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { initAppearance } from '@/features/settings/appearance'
import '@fontsource-variable/inter'
import './styles.css'

initAppearance()
createRoot(document.getElementById('root')!).render(<StrictMode><WorkspacePage /></StrictMode>)
