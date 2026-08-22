import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './statblockThemes.css'
import './zine.css'
import App from './App.tsx'
import { applyTheme, findTheme, loadThemePrefs } from './themes'
import { applyCoverDuotone } from './imagePrefs'
import { AudioPlayerProvider } from './audioPlayer'
import { installNativeDialogFocusFix } from './electronApi'

// Apply the saved theme before the first render so there's no flash of the
// default theme — a single CSS-variable write beats waiting for an effect.
const themePrefs = loadThemePrefs()
applyTheme(findTheme(themePrefs.themeId, themePrefs.customThemes))
// Тот же довод: флаг дуотона ставится до первой отрисовки, иначе обложки
// мигнут исходным цветом перед обработкой.
applyCoverDuotone()

// Внутри Electron: вернуть окну фокус после нативного диалога. В браузере
// ничего не делает.
installNativeDialogFocusFix()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AudioPlayerProvider>
      <App />
    </AudioPlayerProvider>
  </StrictMode>,
)
