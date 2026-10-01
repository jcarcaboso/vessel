import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspacePage } from '@/pages/WorkspacePage'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><WorkspacePage /></StrictMode>)
