import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './statblock.css'
import './zine.css'
import App from './App.tsx'
import { applyTheme, findTheme, loadThemePrefs } from './themes'
import { applyCanvasPaletteVars } from './canvasPalette'
import { applyCoverDuotone } from './imagePrefs'
import { migrateThumbnailStyles } from './thumbnailStyles'
import { AudioPlayerProvider } from './audioPlayer'
import { installNativeDialogFocusFix } from './electronApi'

// Apply the saved theme before the first render so there's no flash of the
// default theme — a single CSS-variable write beats waiting for an effect.
const themePrefs = loadThemePrefs()
applyTheme(findTheme(themePrefs.themeId, themePrefs.customThemes))
applyCanvasPaletteVars()
// Тот же довод: флаг дуотона ставится до первой отрисовки, иначе обложки
// мигнут исходным цветом перед обработкой.
applyCoverDuotone()
migrateThumbnailStyles()

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
