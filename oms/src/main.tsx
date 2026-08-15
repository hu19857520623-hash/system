import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { RoleProvider } from './auth/RoleContext'
import App from './App'
import './index.css'

const Router = import.meta.env.MODE === 'singlefile' ? HashRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <RoleProvider>
        <App />
      </RoleProvider>
    </Router>
  </StrictMode>,
)
