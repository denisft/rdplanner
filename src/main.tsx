import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TooltipProvider } from './ui/Tooltip'
import { ToastProvider } from './ui/Toast'
import { ConfirmProvider } from './ui/Dialog'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
)
