import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App, { MiniAppProvider } from './App'
const bootLoader = document.getElementById('boot-loader')
if (bootLoader) bootLoader.classList.add('hidden')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MiniAppProvider>
      <App />
    </MiniAppProvider>
  </React.StrictMode>,
)
