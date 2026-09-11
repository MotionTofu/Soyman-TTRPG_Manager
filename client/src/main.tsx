import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './dnd-sheet.css'
import './creature-card.css'
import './audio-player.css'
import './home.css'
import './location-map.css'
import './rich-text.css'
import './archive.css'
import './statblock.css'
import './zine.css'
import App from './App.tsx'
import { applyTheme, findTheme, loadThemePrefs } from './themes'
import { applyCanvasPaletteVars } from './canvasPalette'
import { applyImageTreatment } from './imagePrefs'
import { migrateThumbnailStyles } from './thumbnailStyles'
import { AudioPlayerProvider } from './audioPlayer'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './data/queryClient'
import { installNativeDialogFocusFix } from './electronApi'

// Apply the saved theme before the first render so there's no flash of the
// default theme — a single CSS-variable write beats waiting for an effect.
const themePrefs = loadThemePrefs()
applyTheme(findTheme(themePrefs.themeId, themePrefs.customThemes))
applyCanvasPaletteVars()
// Тот же довод: флаг дуотона ставится до первой отрисовки, иначе обложки
// мигнут исходным цветом перед обработкой.
applyImageTreatment()
migrateThumbnailStyles()

// Внутри Electron: вернуть окну фокус после нативного диалога. В браузере
// ничего не делает.
installNativeDialogFocusFix()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Слой данных (docs/adr/0001): кэш, отмена устаревших запросов, обновление задетого. */}
    <QueryClientProvider client={queryClient}>
      <AudioPlayerProvider>
        <App />
      </AudioPlayerProvider>
    </QueryClientProvider>
  </StrictMode>,
)
