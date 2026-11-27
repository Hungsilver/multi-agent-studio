import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import { App } from './App'
import { QuickNote } from './components/layout/QuickNote'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.hash === '#desktop-note' ? <QuickNote desktop /> : <App />}
  </StrictMode>
)
