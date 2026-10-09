import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@/styles.css'
import { PortfolioReview } from './PortfolioReview'

// Deliberately separate from main.tsx and the authenticated application.
createRoot(document.getElementById('root')!).render(<StrictMode><PortfolioReview /></StrictMode>)
