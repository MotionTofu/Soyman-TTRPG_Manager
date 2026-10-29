import { installCutsceneKeyboard } from './cutscenes/keyboard'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './dnd-sheet.css'
import './creature-card.css'
import './paper.css'
import './audio-player.css'
import './home.css'
import './location-map.css'
import './rich-text.css'
import './archive.css'
import './statblock.css'
import './zine.css'
import './fantasy-punk-skin.css'
import './d-system.css'
import './cursorSets.css'
import App from './App.tsx'
import { applyTheme, findTheme, loadThemePrefs } from './themes'
import { applyCanvasPaletteVars } from './canvasPalette'
import { applyImageTreatment } from './imagePrefs'
import { migrateThumbnailStyles } from './thumbnailStyles'
import { AudioPlayerProvider } from './audioPlayer'
import { isPlayerDisplayRoute } from './components/presentation/playerDisplayWindow'
import { installAuxiliaryAudioGuard } from './sound/auxiliaryAudio'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './data/queryClient'
import { installNativeDialogFocusFix } from './electronApi'
import { applyCursorSet, loadCursorSet } from './cursorSets'

// Register before any page installs capture shortcuts; inactive until the GM player claims it.
installCutsceneKeyboard()

// Apply the saved theme before the first render so there's no flash of the
// default theme — a single CSS-variable write beats waiting for an effect.
const themePrefs = loadThemePrefs()
applyTheme(findTheme(themePrefs.themeId))
applyCanvasPaletteVars()
// Тот же довод: флаг дуотона ставится до первой отрисовки, иначе обложки
// мигнут исходным цветом перед обработкой.
applyImageTreatment()
migrateThumbnailStyles()
// Набор курсоров — до первой отрисовки, чтобы стрелка не мигала системной.
applyCursorSet(loadCursorSet())

// Внутри Electron: вернуть окну фокус после нативного диалога. В браузере
// ничего не делает.
installNativeDialogFocusFix()
installAuxiliaryAudioGuard()

// Player displays never mount an audio engine, including on reload.
const application = isPlayerDisplayRoute(window.location.pathname) ? <App /> : <AudioPlayerProvider><App /></AudioPlayerProvider>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Слой данных (docs/adr/0001): кэш, отмена устаревших запросов, обновление задетого. */}
    <QueryClientProvider client={queryClient}>
      {application}
    </QueryClientProvider>
  </StrictMode>,
)
