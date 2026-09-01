import { useEffect, useState } from "react";
import { api } from "../api/client";
import {
  allThemes, applyTheme, findTheme, loadThemePrefs,
  saveThemePrefs, loadRadiusOverride, saveRadiusOverride,
} from "../themes";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { useImageCrop } from "../hooks/useImageCrop";
import { loadCoverDuotone, saveCoverDuotone } from "../imagePrefs";
import { loadHideFinance, saveHideFinance } from "../financePrivacy";
import { loadBagSize, saveBagSize, MIN_BAG_SIZE, MAX_BAG_SIZE } from "../bag";
import { loadUseEpithets, saveUseEpithets } from "../initiativeTrackerPrefs";
import {
  DND_ABILITY_PRIMARY_OPTIONS, DND_SKILL_SORT_OPTIONS, loadDndPrefs, saveDndPrefs,
  type DndAbilityPrimary, type DndSkillSortMode,
} from "../dndPrefs";
import type { AppSettings } from "../types";

const DEFAULT_RADIUS = 0;

export function AppearanceSettingsPage() {
  const [prefs, setPrefs] = useState(loadThemePrefs());
  const [radius, setRadius] = useState(() => loadRadiusOverride() ?? DEFAULT_RADIUS);
  const [duotone, setDuotone] = useState(loadCoverDuotone);

  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [uploadingHomeBg, setUploadingHomeBg] = useState(false);
  const [hideFinance, setHideFinance] = useState(loadHideFinance);
  const [bagSize, setBagSize] = useState(loadBagSize);
  const [useEpithets, setUseEpithets] = useState(loadUseEpithets);
  const [dndPrefs, setDndPrefs] = useState(loadDndPrefs());

  function refreshAppSettings() {
    api.get<AppSettings>("/app-settings").then(setAppSettings);
  }
  useEffect(refreshAppSettings, []);

  async function uploadHomeBackground(file: File | null) {
    if (!file) return;
    setUploadingHomeBg(true);
    const form = new FormData();
    form.append("file", file);
    await api.post("/app-settings/home-background", form);
    setUploadingHomeBg(false);
    refreshAppSettings();
  }
  const homeBgCrop = useImageCrop("background", uploadHomeBackground);

  async function removeHomeBackground() {
    await api.del("/app-settings/home-background");
    refreshAppSettings();
  }

  // Apply once on mount too, in case this page is reached without a full
  // reload (boot-time application happens in main.tsx).
  useEffect(() => {
    applyTheme(findTheme(prefs.themeId, prefs.customThemes));
  }, [prefs.themeId, prefs.customThemes]);

  function select(themeId: string) {
    const next = { ...prefs, themeId };
    setPrefs(next);
    saveThemePrefs(next);
  }

  function changeRadius(px: number) {
    setRadius(px);
    saveRadiusOverride(px === 0 ? null : px);
    applyTheme(findTheme(prefs.themeId, prefs.customThemes));
  }

  function changeHideFinance(hide: boolean) {
    setHideFinance(hide);
    saveHideFinance(hide);
  }

  function changeBagSize(size: number) {
    const clamped = Math.min(MAX_BAG_SIZE, Math.max(MIN_BAG_SIZE, size));
    setBagSize(clamped);
    saveBagSize(clamped);
  }

  function changeUseEpithets(use: boolean) {
    setUseEpithets(use);
    saveUseEpithets(use);
  }

  function changeDndSkillSort(mode: DndSkillSortMode) {
    const next = { ...dndPrefs, skillSortMode: mode };
    setDndPrefs(next);
    saveDndPrefs(next);
  }

  function changeDndAbilityPrimary(mode: DndAbilityPrimary) {
    const next = { ...dndPrefs, abilityPrimary: mode };
    setDndPrefs(next);
    saveDndPrefs(next);
  }

  const themes = allThemes(prefs.customThemes);

  return (
    <div className="stack">
      <h1>Внешний вид</h1>

      <details className="card stack">
        <summary>
          <strong className="entry-title">Фон</strong>
        </summary>
        <h3>Фон главной страницы</h3>
        <p className="muted">
          Показывается на странице «Главная», приглушённый градиентом — как и в кампаниях.
        </p>
        {appSettings?.home_background_url && (
          <img
            src={appSettings.home_background_url}
            alt=""
            style={{ maxWidth: 300, borderRadius: "var(--card-radius)" }}
          />
        )}
        <div className="row">
          <label>
            {uploadingHomeBg ? "Загрузка…" : "Выбрать изображение"}
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => homeBgCrop.onSelect(e.target.files?.[0] ?? null)}
            />
          </label>
          {homeBgCrop.modal}
          {appSettings?.home_background_url && (
            <button className="danger" onClick={removeHomeBackground}>
              Убрать фон
            </button>
          )}
        </div>
        <span className="muted image-hint">{IMAGE_HINT}</span>
      </details>

      <details className="card stack">
        <summary>
          <strong className="entry-title">Приватность</strong>
        </summary>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={hideFinance}
            onChange={(e) => changeHideFinance(e.target.checked)}
          />
          Скрывать коммерческую составляющую интерфейса
        </label>
        <span className="muted">
          Прячет суммы заработка, ставки и статус оплаты — на Главной, в карточках и профилях
          кампаний, в сессиях. Сами данные никуда не деваются, просто не отображаются (удобно при
          демонстрации экрана).
        </span>
      </details>

      <details className="card stack">
        <summary>
          <strong className="entry-title">Мешок</strong>
        </summary>
        <p className="muted">
          Блок в боковой панели (между поиском и закреплёнными страницами) для временного хранения
          сущностей — нажмите «+» в пустой ячейке на странице любой сущности, чтобы отправить её в
          мешок, а затем перетащите оттуда куда нужно.
        </p>
        <label className="stack" style={{ maxWidth: 200, gap: 4 }}>
          Количество ячеек
          <input
            type="number"
            min={MIN_BAG_SIZE}
            max={MAX_BAG_SIZE}
            value={bagSize}
            onChange={(e) => changeBagSize(Number(e.target.value) || MIN_BAG_SIZE)}
          />
        </label>
      </details>

      <details className="card stack">
        <summary>
          <strong className="entry-title">Пульт сессии</strong>
        </summary>
        <h3>Трекер инициативы</h3>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={useEpithets}
            onChange={(e) => changeUseEpithets(e.target.checked)}
          />
          Добавлять эпитеты существам с одним и тем же именем?
        </label>
        <span className="muted">
          Если включено, при добавлении в трекер нескольких существ с одинаковым именем (например,
          пяти Гоблинов) они получат разные прилагательные-эпитеты, чтобы их было проще различить в
          списке — Жадный Гоблин, Хромой Гоблин и т. д.
        </span>
      </details>

      <details className="card stack">
        <summary>
          <strong className="entry-title">Темы</strong>
        </summary>
        <p className="muted">Тема применяется мгновенно ко всему приложению.</p>

        <label className="stack" style={{ maxWidth: 420, gap: 4 }}>
          Скругление углов: {radius}px
          <input
            type="range"
            min={0}
            max={28}
            value={radius}
            onChange={(e) => changeRadius(Number(e.target.value))}
          />
          <span className="muted">
            Общее для всех тем, независимо от выбранной. По умолчанию — как в «Классической» ({DEFAULT_RADIUS}px).
            Действует на внешний угол карточки; плашки, чипы и бейджи внутри остаются прямоугольными.
          </span>
        </label>

        <label className="row" style={{ gap: 8, alignItems: "flex-start", maxWidth: 420 }}>
          <input
            type="checkbox"
            checked={duotone}
            onChange={(e) => {
              setDuotone(e.target.checked);
              saveCoverDuotone(e.target.checked);
            }}
          />
          <span className="stack" style={{ gap: 2 }}>
            Обрабатывать обложки под тему
            <span className="muted">
              Обложки кампаний и фон главной перекрашиваются в два цвета выбранной темы, чтобы разные
              по стилю арты читались как один экран. Тоже общее для всех тем. Карт, портретов и галереи
              не касается — там изображения всегда такие, как вы их загрузили.
            </span>
          </span>
        </label>

        <div className="grid-cards" style={{ marginTop: 10 }}>
          {themes.map((t) => (
              <div
              key={t.id}
              className="card"
              onClick={() => select(t.id)}
              style={{ cursor: "pointer", borderColor: t.id === prefs.themeId ? t.vars["--accent"] : undefined, borderWidth: t.id === prefs.themeId ? 1 : undefined }}
            >
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <span style={{ width: 18, height: 18, borderRadius: 0, background: t.vars["--paper"], border: "1px solid " + t.vars["--line"] }} />
                <span style={{ width: 18, height: 18, borderRadius: 0, background: t.vars["--paper-2"], border: "1px solid " + t.vars["--line"] }} />
                <span style={{ width: 18, height: 18, borderRadius: 0, background: t.vars["--accent"] }} />
                <span style={{ width: 18, height: 18, borderRadius: 0, background: t.vars["--ink"] }} />
              </div>
              <div style={{ fontFamily: t.vars["--font-display"], fontWeight: 600 }}>{t.name}</div>
              {t.id === prefs.themeId && <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.1em", color: t.vars["--accent"], fontWeight: 600, marginTop: 4 }}>Выбрана</div>}
            </div>
          ))}
        </div>
      </details>

      <details className="card stack">
        <summary>
          <strong className="entry-title">ДнД 5.5</strong>
        </summary>
        <div>
          <div className="muted" style={{ marginBottom: 4 }}>
            Главное число на кости характеристики
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
            {DND_ABILITY_PRIMARY_OPTIONS.map((opt) => (
              <label key={opt.key} className="row" style={{ gap: 6 }}>
                <input
                  type="radio"
                  name="dnd-ability-primary"
                  checked={dndPrefs.abilityPrimary === opt.key}
                  onChange={() => changeDndAbilityPrimary(opt.key)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            Второе число уходит подписью под кость, спасбросок открывается щелчком по ней. Общее
            для статблока существа, карточки существа и листа персонажа.
          </div>
        </div>

        <div>
          <div className="muted" style={{ marginBottom: 4 }}>
            Сортировка навыков во вкладке "Навыки" статблока персонажа
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
            {DND_SKILL_SORT_OPTIONS.map((opt) => (
              <label key={opt.key} className="row" style={{ gap: 6 }}>
                <input
                  type="radio"
                  name="dnd-skill-sort"
                  checked={dndPrefs.skillSortMode === opt.key}
                  onChange={() => changeDndSkillSort(opt.key)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      </details>

    </div>
  );
}
