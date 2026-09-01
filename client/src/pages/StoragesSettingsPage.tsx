import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useConfirm } from "../hooks/useConfirm";
import { safeGetItem, safeSetItem } from "../utils/safeStorage";
import { ModulesTab } from "../components/ModulesTab";
import { UpdateChecker } from "../components/UpdateChecker";
import { DatabaseSizeCard } from "../components/DatabaseSizeCard";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { ThemeEditorModal } from "../components/ThemeEditorModal";
import { hasElectronAPI, isPathSafeForExplorer } from "../electronApi";
import { NavIcon } from "../components/NavIcons";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import type { AppSettings, StorageProfile } from "../types";
import {
  allThemes, applyTheme, findTheme, loadThemePrefs,
  saveThemePrefs, loadRadiusOverride, saveRadiusOverride,
  type Theme,
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

function loadSectionOpen(key: string, fallback: boolean): boolean {
  const v = safeGetItem(`storagesSectionOpen_${key}`);
  return v == null ? fallback : v === "1";
}
function saveSectionOpen(key: string, open: boolean) {
  safeSetItem(`storagesSectionOpen_${key}`, open ? "1" : "0");
}

export function StoragesSettingsPage() {
  const location = useLocation() as { state?: { fromAppearance?: boolean } };
  const fromAppearance = location.state?.fromAppearance === true;
  const [confirmDialog, confirm] = useConfirm();
  const [activeId, setActiveId] = useState("");
  const [storages, setStorages] = useState<StorageProfile[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");

  // Appearance state moved from AppearanceSettingsPage
  const [prefs, setPrefs] = useState(loadThemePrefs());
  const [radius, setRadius] = useState(() => loadRadiusOverride() ?? 0);
  const [duotone, setDuotone] = useState(loadCoverDuotone);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [uploadingHomeBg, setUploadingHomeBg] = useState(false);
  const [hideFinance, setHideFinance] = useState(loadHideFinance);
  const [bagSize, setBagSize] = useState(loadBagSize);
  const [useEpithets, setUseEpithets] = useState(loadUseEpithets);
  const [dndPrefs, setDndPrefs] = useState(loadDndPrefs());

  const [fadeDraft, setFadeDraft] = useState("0");
  const fadeSaveRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const errorTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (fadeSaveRef.current) window.clearTimeout(fadeSaveRef.current);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
  }, []);

  // persist open for res-groups
  const [bgOpen, setBgOpen] = useState(() => loadSectionOpen("bg", true));
  const [themesOpen, setThemesOpen] = useState(() => loadSectionOpen("themes", true));
  const [privacyOpen, setPrivacyOpen] = useState(() => loadSectionOpen("privacy", false));
  const [bagOpen, setBagOpen] = useState(() => loadSectionOpen("bag", false));
  const [dndOpen, setDndOpen] = useState(() => loadSectionOpen("dnd", true));
  const [pultOpen, setPultOpen] = useState(() => loadSectionOpen("pult", false));

  const [importDragOver, setImportDragOver] = useState(false);

  // Theme context menu + editor
  const [themeMenu, setThemeMenu] = useState<{ x: number; y: number; theme: Theme } | null>(null);
  const [themeEditor, setThemeEditor] = useState<Theme | null>(null);

  function refreshAppSettings(signal?: AbortSignal) {
    api.get<AppSettings>("/app-settings", signal ? { signal } : undefined)
      .then((s) => {
        setFadeDraft(String(Math.round(s.fade_duration_ms / 1000)));
        setAppSettings(s);
      })
      .catch((e) => { if ((e as Error).name === "AbortError") return; });
  }
  useEffect(() => {
    const ac = new AbortController();
    refreshAppSettings(ac.signal);
    return () => ac.abort();
  }, []);
  useEffect(() => {
    applyTheme(findTheme(prefs.themeId, prefs.customThemes));
  }, [prefs.themeId, prefs.customThemes]);
  function selectTheme(themeId: string) {
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
  function changeDndAbilityPrimary(mode: DndAbilityPrimary) {
    const next = { ...dndPrefs, abilityPrimary: mode };
    setDndPrefs(next);
    saveDndPrefs(next);
  }
  function changeDndSkillSort(mode: DndSkillSortMode) {
    const next = { ...dndPrefs, skillSortMode: mode };
    setDndPrefs(next);
    saveDndPrefs(next);
  }
  async function uploadHomeBackground(file: File | null) {
    if (!file) return;
    setUploadingHomeBg(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post("/app-settings/home-background", form);
      refreshAppSettings();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      showError(e instanceof Error ? e.message.slice(0, 200) : "Не удалось загрузить фон");
    } finally {
      setUploadingHomeBg(false);
    }
  }
  const homeBgCrop = useImageCrop("background", uploadHomeBackground);
  async function removeHomeBackground() {
    try {
      await api.del("/app-settings/home-background");
      refreshAppSettings();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 1800);
  }
  function showError(msg: string, ttlMs = 3000) {
    setError(msg);
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    if (ttlMs > 0) errorTimerRef.current = window.setTimeout(() => setError(""), ttlMs);
  }

  function scheduleFadeSave(val: string) {
    const seconds = Math.max(0, Number(val) || 0);
    if (fadeSaveRef.current) window.clearTimeout(fadeSaveRef.current);
    fadeSaveRef.current = window.setTimeout(async () => {
      try {
        await api.put("/app-settings/fade-duration", { fade_duration_ms: seconds * 1000 });
        refreshAppSettings();
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          showError("Не удалось сохранить затухание");
        }
      }
    }, 600);
  }
  async function saveFadeDurationNow(val: string) {
    const seconds = Math.max(0, Number(val) || 0);
    if (fadeSaveRef.current) window.clearTimeout(fadeSaveRef.current);
    await api.put("/app-settings/fade-duration", { fade_duration_ms: seconds * 1000 });
    showToast("Сохранено");
    refreshAppSettings();
  }

  const [newName, setNewName] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [creating, setCreating] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [renamingSaving, setRenamingSaving] = useState(false);

  const [importName, setImportName] = useState("");
  const [importFolder, setImportFolder] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  function refresh(signal?: AbortSignal) {
    api
      .get<{ activeId: string; storages: StorageProfile[] }>("/storages", signal ? { signal } : undefined)
      .then((r) => {
        setActiveId(r.activeId);
        setStorages(r.storages);
      })
      .catch((e) => { if ((e as Error).name === "AbortError") return; });
  }
  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    return () => ac.abort();
  }, []);

  async function pickNewFolder() {
    if (!hasElectronAPI()) return;
    const picked = await window.electronAPI!.pickFolder();
    if (picked) setNewFolder(picked);
  }
  async function pickImportFolder() {
    if (!hasElectronAPI()) return;
    const picked = await window.electronAPI!.pickFolder();
    if (picked) setImportFolder(picked);
  }

  async function createStorage() {
    if (creating) return;
    if (!newName.trim() || !newFolder.trim()) {
      showError("Укажи название и путь", 2500);
      return;
    }
    setCreating(true);
    setError("");
    try {
      await api.post("/storages", { name: newName, folderPath: newFolder });
      setNewName("");
      setNewFolder("");
      refresh();
      showToast("Хранилище создано");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Не удалось создать хранилище";
      setError(msg.slice(0, 200));
    } finally {
      setCreating(false);
    }
  }

  async function activate(id: string) {
    if (activatingId || removingId || creating || importing) return;
    const target = storages.find((s) => s.id === id);
    const preview = target ? `«${target.name}»\n${target.vaultRoot}` : id;
    const ok = await confirm({
      title: "Переключить хранилище?",
      message: `Активировать ${preview}\n\nПриложение перезагрузится и начнёт работать с выбранным хранилищем. Несохранённые черновики в других вкладках могут потеряться.`,
      confirmLabel: "Переключить",
      cancelLabel: "Отмена",
      danger: true,
    });
    if (!ok) return;
    setActivatingId(id);
    setError("");
    try {
      await api.post(`/storages/${id}/activate`);
      window.location.reload();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message.slice(0, 200) : "Не удалось переключить хранилище");
    } finally {
      setActivatingId(null);
    }
  }

  async function remove(id: string) {
    if (activatingId || removingId || creating || importing) return;
    const ok = await confirm({ title: "Убрать хранилище?", message: "Убрать хранилище из списка? Сами файлы на диске не удаляются.", confirmLabel: "Убрать", cancelLabel: "Отмена" });
    if (!ok) return;
    setRemovingId(id);
    setError("");
    try {
      await api.del(`/storages/${id}`);
      refresh();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message.slice(0, 200) : "Не удалось убрать хранилище");
    } finally {
      setRemovingId(null);
    }
  }

  async function saveRename() {
    if (renamingSaving) return;
    if (!renamingId || !renameDraft.trim()) {
      showError("Название не может быть пустым", 1500);
      return;
    }
    setRenamingSaving(true);
    try {
      await api.put(`/storages/${renamingId}`, { name: renameDraft.trim() });
      setRenamingId(null);
      setError("");
      refresh();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      showError(e instanceof Error ? e.message.slice(0, 200) : "Не удалось переименовать", 2500);
    } finally {
      setRenamingSaving(false);
    }
  }

  async function importBackup() {
    if (!importFile || !importName.trim() || !importFolder.trim()) {
      showError("Укажи название, папку и zip", 2500);
      return;
    }
    if (!importFile.name.toLowerCase().endsWith(".zip")) {
      showError("Нужен .zip бэкапа (app.db + RPG-Vault)", 2500);
      return;
    }
    setImporting(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", importFile);
      form.append("name", importName);
      form.append("folderPath", importFolder);
      await api.post("/storages/import-backup", form);
      setImportName("");
      setImportFolder("");
      setImportFile(null);
      refresh();
      showToast("Импортировано");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      showError(e instanceof Error ? e.message.slice(0, 200) : "Не удалось импортировать бэкап");
    } finally {
      setImporting(false);
    }
  }

  function onImportDrop(e: React.DragEvent) {
    e.preventDefault();
    setImportDragOver(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      showError("Перетащи .zip бэкапа", 2500);
      return;
    }
    setImportFile(file);
  }

  async function openInExplorer(path: string) {
    if (!isPathSafeForExplorer(path)) {
      showToast("Недопустимый путь");
      return;
    }
    if (hasElectronAPI() && window.electronAPI?.showInExplorer) {
      const r = await window.electronAPI.showInExplorer(path);
      if (!r.ok) showToast(r.error ?? "Не удалось открыть папку");
      return;
    }
    if (hasElectronAPI() && window.electronAPI?.openPath) {
      const r = await window.electronAPI.openPath(path);
      if (!r.ok) showToast(r.error ?? "Не удалось открыть");
      return;
    }
    navigator.clipboard.writeText(path).then(() => {
      showToast("Путь скопирован");
    }).catch(() => {
      showToast("Не удалось скопировать");
    });
  }

  const filtered = useMemo(() => storages.filter((s) => {
    if (!q.trim()) return true;
    const qq = q.toLowerCase();
    return s.name.toLowerCase().includes(qq) || s.vaultRoot.toLowerCase().includes(qq);
  }), [storages, q]);
  const hasElectron = useMemo(() => hasElectronAPI(), []);
  const themes = useMemo(() => allThemes(prefs.customThemes), [prefs.customThemes]);

  // activeTab внизу намеренно: перенос наверх сдвинул бы индексы хуков и
  // сломал бы сохраненное состояние у существующих пользователей до перезагрузки.
  const [activeTab, setActiveTab] = useState(() => {
    const v = safeGetItem("storagesActiveTab") || "interface";
    return v === "links" || v === "pult" ? "interface" : v;
  });
  useEffect(() => {
    safeSetItem("storagesActiveTab", activeTab);
  }, [activeTab]);
  // Фаза 4: перетаскивание zip вне зоны не должно открывать файл в браузере
  useEffect(() => {
    if (activeTab !== "store") return;
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [activeTab]);

  // Предупреждение перед перезагрузкой если есть черновики
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (newName.trim() || newFolder.trim() || renameDraft.trim() || importName.trim() || importFolder.trim() || renamingId) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [newName, newFolder, renameDraft, importName, importFolder, renamingId]);

  return (
    <div className="stack" style={{ paddingBottom: 60 }}>
      {confirmDialog}
      <SectionHeading section="storages" compact>
        Настройки
      </SectionHeading>
      {fromAppearance && (
        <div className="card" role="status" style={{ borderLeft: "1px solid var(--accent)", background: "var(--paper-2)" }}>
          <span style={{ fontWeight: 600 }}>Внешний вид переехал в Настройки → Интерфейс</span>
          <div className="muted" style={{ marginTop: 4 }}>Старая закладка <code>/appearance</code> теперь здесь. Темы, скругление и дуотон — во вкладке «Интерфейс».</div>
        </div>
      )}
      {toast && (
        <div className="settings-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
      {error && <div id="storage-error" className="backup-info error" role="alert">{error}</div>}

      <div className="tabs" role="tablist" aria-label="Разделы настроек">
        <button role="tab" aria-selected={activeTab === "interface"} className={activeTab === "interface" ? "active" : ""} onClick={() => setActiveTab("interface")}>
          Интерфейс
        </button>
        <button role="tab" aria-selected={activeTab === "store"} className={activeTab === "store" ? "active" : ""} onClick={() => setActiveTab("store")}>
          Хранилище
        </button>
        <button role="tab" aria-selected={activeTab === "modules"} className={activeTab === "modules" ? "active" : ""} onClick={() => setActiveTab("modules")}>
          Модули
        </button>
        <button role="tab" aria-selected={activeTab === "systems"} className={activeTab === "systems" ? "active" : ""} onClick={() => setActiveTab("systems")}>
          Системы
        </button>
        <button role="tab" aria-selected={activeTab === "player"} className={activeTab === "player" ? "active" : ""} onClick={() => setActiveTab("player")}>
          Плеер
        </button>
        {hasElectron && (
          <button role="tab" aria-selected={activeTab === "updates"} className={activeTab === "updates" ? "active" : ""} onClick={() => setActiveTab("updates")}>
            Обновления
          </button>
        )}
      </div>

      {activeTab === "store" && (
        <div className="stack" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0, maxWidth: "62ch" }}>
            Хранилище — папка на диске (база + вейлт). Активно одно. Переключение — с перезагрузкой.
          </p>

          <div className="res-toolbar" style={{ marginTop: 4 }}>
            <input className="res-toolbar__search" placeholder="Поиск по имени или пути…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по хранилищам" />
            <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>{filtered.length} / {storages.length}</span>
          </div>

          <div className="stack" style={{ gap: 4 }}>
            {filtered.map((s) => (
              <div key={s.id} className={`res-row${s.id === activeId ? " is-active" : ""}`}>
                <div className="res-row__line" style={{ minHeight: 38 }}>
                  <span className="res-row__mark" aria-hidden="true">
                    <NavIcon name={s.id === activeId ? "check" : "storages"} />
                  </span>
                  {renamingId === s.id ? (
                    <span style={{ flex: 1, display: "flex", gap: 6, alignItems: "center" }}>
                      <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} autoFocus disabled={renamingSaving} onKeyDown={(e) => { if (e.key === "Enter") void saveRename(); if (e.key === "Escape") setRenamingId(null); }} style={{ flex: 1 }} aria-label="Новое название хранилища" />
                      <button className="primary" onClick={saveRename} disabled={renamingSaving} style={{ height: 26, padding: "0 8px" }}>
                        {renamingSaving ? "…" : "Сохранить"}
                      </button>
                      <button onClick={() => setRenamingId(null)} disabled={renamingSaving} style={{ height: 26 }}>
                        Отмена
                      </button>
                    </span>
                  ) : (
                    <>
                      <span className="res-row__name" title={s.name} style={{ fontWeight: 600 }}>
                        {s.name} {s.id === activeId && <span className="res-row__tag" style={{ marginLeft: 6, background: s.id === activeId ? "var(--on-surface)" : undefined, color: s.id === activeId ? "var(--surface)" : undefined, borderColor: s.id === activeId ? "var(--on-surface)" : undefined }}>Активно</span>}
                      </span>
                      <span className="res-row__tags" style={{ display: "none" }} />
                    </>
                  )}
                  <span className="res-row__actions">
                    {s.id !== activeId && (
                      <button type="button" className="res-row__act primary" onClick={() => activate(s.id)} disabled={!!activatingId || !!removingId} title="Активировать" aria-label={`Активировать ${s.name}`} style={{ width: "auto", padding: "0 8px", fontSize: 11 }}>
                        {activatingId === s.id ? "…" : "Активировать"}
                      </button>
                    )}
                    <button type="button" className="res-row__act" onClick={() => { setRenamingId(s.id); setRenameDraft(s.name); }} disabled={!!activatingId || !!removingId} title="Переименовать" aria-label={`Переименовать ${s.name}`}>
                      <NavIcon name="edit" />
                    </button>
                    {s.id !== activeId && (
                      <button type="button" className="res-row__act" onClick={() => remove(s.id)} disabled={!!activatingId || !!removingId} title="Убрать из списка" aria-label={`Убрать ${s.name}`}>
                        {removingId === s.id ? "…" : <NavIcon name="delete" />}
                      </button>
                    )}
                  </span>
                </div>
                <div className="muted" style={{ padding: "0 12px 4px 44px", fontSize: 11, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{s.vaultRoot}</span>
                  <button type="button" onClick={() => openInExplorer(s.vaultRoot)} style={{ fontSize: 11, padding: "2px 6px", height: 36 }}>
                    Открыть
                  </button>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(s.vaultRoot).then(() => showToast("Скопировано")).catch(() => showToast("Не удалось скопировать")); }} style={{ fontSize: 11, padding: "2px 6px", height: 36 }}>
                    Копировать
                  </button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              storages.length === 0 ? (
                <EmptyState icon="barcode" title="Хранилищ нет" hint="Создайте первое — укажите название и путь к папке." />
              ) : (
                <EmptyState icon="barcode" title="Ничего не найдено" hint={`По «${q}» ничего нет.`} action={<button onClick={() => setQ("")}>Сбросить поиск</button>} />
              )
            )}
          </div>

          <div style={{ padding: 0 }}>
            <DatabaseSizeCard />
          </div>

          <div className="card res-add" style={{ gap: 12, alignItems: "end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px", minWidth: 0 }}>
              <span className="res-toolbar__filter-label">Название</span>
              <input placeholder="Моё хранилище" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: "100%" }} required aria-label="Название хранилища" aria-invalid={!!error && !newName.trim() ? "true" : undefined} aria-describedby={error ? "storage-error" : undefined} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 280px", minWidth: 0 }}>
              <span className="res-toolbar__filter-label">Путь к папке</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input placeholder="D:\RPG-Storage-2" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} style={{ flex: 1 }} required aria-label="Путь к папке хранилища" aria-invalid={!!error && !newFolder.trim() ? "true" : undefined} aria-describedby={error ? "storage-error" : undefined} />
                {hasElectron && (
                  <button type="button" onClick={pickNewFolder} title="Обзор" style={{ height: 32 }}>
                    <NavIcon name="folder" /> Обзор
                  </button>
                )}
              </div>
            </label>
            <button className="primary" onClick={createStorage} disabled={creating} style={{ height: 32, whiteSpace: "nowrap" }}>
              {creating ? "Создаю…" : "Создать"}
            </button>
          </div>

          <div
            className={`card res-add import-drop-zone${importDragOver ? " drag-over" : ""}`}
            style={{ gap: 12, alignItems: "end" }}
            onDragOver={(e) => { e.preventDefault(); setImportDragOver(true); }}
            onDragLeave={() => setImportDragOver(false)}
            onDrop={onImportDrop}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px", minWidth: 0 }}>
              <span className="res-toolbar__filter-label">Название</span>
              <input placeholder="Из бэкапа" value={importName} onChange={(e) => setImportName(e.target.value)} style={{ width: "100%" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px", minWidth: 0 }}>
              <span className="res-toolbar__filter-label">Папка назначения</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input placeholder="D:\Restore" value={importFolder} onChange={(e) => setImportFolder(e.target.value)} style={{ flex: 1 }} />
                {hasElectron && (
                  <button type="button" onClick={pickImportFolder} title="Обзор" style={{ height: 32 }}>
                    <NavIcon name="folder" />
                  </button>
                )}
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 1 200px", minWidth: 140 }}>
              <span className="res-toolbar__filter-label">Zip бэкапа {importFile ? `· ${importFile.name}` : ""}</span>
              <input type="file" accept=".zip,application/zip" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} aria-label="Файл бэкапа" />
            </label>
            <button className="primary" onClick={importBackup} disabled={importing} style={{ height: 32, whiteSpace: "nowrap" }}>
              {importing ? "Импортирую…" : "Импортировать"}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 11, padding: "0 4px" }}>
            {importDragOver ? "Отпусти zip — подхватим" : "Перетащи .zip сюда — бросим в зону. Zip содержит app.db + RPG-Vault."}
          </div>
          <div className="muted" style={{ fontSize: 12, padding: "8px 4px", borderTop: "1px solid var(--line)" }}>
            Битые ссылки — в <a href="/health" style={{ color: "var(--accent)" }}>Здоровье → Проверить</a>
          </div>
        </div>
      )}

      {activeTab === "interface" && (
        <div className="stack" style={{ gap: 12 }}>
          <details className="card res-group" open={bgOpen} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setBgOpen(o); saveSectionOpen("bg", o); }}>
            <summary className="res-group__band">
              <span className="res-group__title">Фон</span>
            </summary>
            <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
              <p className="muted" style={{ margin: 0, maxWidth: "62ch" }}>Показывается на «Главная», приглушённый градиентом.</p>
              {appSettings?.home_background_url && (
                <img src={appSettings.home_background_url} alt="" style={{ maxWidth: 300, display: "block", border: "1px solid var(--line)" }} />
              )}
              <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ cursor: uploadingHomeBg ? "wait" : "pointer", opacity: uploadingHomeBg ? 0.6 : 1 }}>
                  <span className="row" style={{ gap: 6 }}><NavIcon name="folder" /> {uploadingHomeBg ? "Загрузка…" : "Выбрать изображение"}</span>
                  <input type="file" accept={IMAGE_ACCEPT} disabled={uploadingHomeBg} style={{ display: "none" }} onChange={(e) => homeBgCrop.onSelect(e.target.files?.[0] ?? null)} />
                </label>
                {homeBgCrop.modal}
                {appSettings?.home_background_url && (
                  <button className="danger" onClick={removeHomeBackground} disabled={uploadingHomeBg}>
                    Убрать фон
                  </button>
                )}
                {uploadingHomeBg && <span className="muted" style={{ fontSize: 12 }}>Загружаю…</span>}
              </div>
              <span className="muted image-hint" style={{ maxWidth: "62ch" }}>{IMAGE_HINT}</span>
            </div>
          </details>

          <details className="card res-group" open={themesOpen} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setThemesOpen(o); saveSectionOpen("themes", o); }}>
            <summary className="res-group__band">
              <span className="res-group__title">Темы</span>
              <span className="res-group__count">{themes.length}</span>
            </summary>
            <div className="res-group__body" style={{ padding: 12, gap: 12, display: "flex", flexDirection: "column" }}>
              <p className="muted" style={{ margin: 0, maxWidth: "62ch" }}>Тема применяется мгновенно. Скругление и дуотон — общие для всех тем.</p>
              <label className="stack" style={{ maxWidth: 420, gap: 4 }}>
                Скругление внешнего угла карточки: {radius}px
                <input type="range" min={0} max={28} value={radius} onChange={(e) => changeRadius(Number(e.target.value))} />
                <span className="muted" style={{ fontSize: 11, maxWidth: "62ch" }}>Действует только на внешний угол карточки; плашки, чипы и бейджи внутри остаются прямоугольными (§4).</span>
              </label>
              <label className="row" style={{ gap: 8, alignItems: "flex-start", maxWidth: 420 }}>
                <input type="checkbox" checked={duotone} onChange={(e) => { setDuotone(e.target.checked); saveCoverDuotone(e.target.checked); }} />
                <span className="stack" style={{ gap: 2 }}>
                  Обрабатывать обложки под тему
                  <span className="muted" style={{ maxWidth: "62ch" }}>Обложки и фон перекрашиваются в два цвета темы.</span>
                </span>
              </label>
              <div className="grid-cards" style={{ marginTop: 6 }}>
                {themes.map((th) => {
                  const selected = th.id === prefs.themeId;
                  return (
                    <div key={th.id} className={`card theme-card${selected ? " is-selected" : ""}`} onClick={() => selectTheme(th.id)} onContextMenu={(e) => { e.preventDefault(); setThemeMenu({ x: e.clientX, y: e.clientY, theme: th }); }} role="button" aria-pressed={selected} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectTheme(th.id); } }}>
                      <div className="theme-swatches">
                        <span className="theme-swatch" style={{ background: th.vars["--paper"] }} aria-hidden="true" />
                        <span className="theme-swatch" style={{ background: th.vars["--paper-2"] }} aria-hidden="true" />
                        <span className="theme-swatch theme-swatch--accent" style={{ background: th.vars["--accent"] }} aria-hidden="true" />
                        <span className="theme-swatch" style={{ background: th.vars["--ink"] }} aria-hidden="true" />
                      </div>
                      <div style={{ fontFamily: th.vars["--font-display"], fontWeight: 600 }}>{th.name}</div>
                      {selected && <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--on-surface)", fontWeight: 600, marginTop: 4 }}>Выбрана</div>}
                    </div>
                  );
                })}
              </div>
              {themeMenu && (
                <ContextMenu
                  x={themeMenu.x}
                  y={themeMenu.y}
                  title={themeMenu.theme.name}
                  items={[
                    ...(themeMenu.theme.id !== prefs.themeId ? [{
                      label: "Установить",
                      onClick: () => selectTheme(themeMenu.theme.id),
                    }] : []),
                    {
                      label: "Редактировать",
                      onClick: () => setThemeEditor(themeMenu.theme),
                    },
                  ] as ContextMenuItem[]}
                  onClose={() => setThemeMenu(null)}
                />
              )}
              {themeEditor && (
                <ThemeEditorModal
                  theme={themeEditor}
                  prefs={prefs}
                  onSave={(newPrefs) => {
                    setPrefs(newPrefs);
                    saveThemePrefs(newPrefs);
                    applyTheme(findTheme(newPrefs.themeId, newPrefs.customThemes));
                    setThemeEditor(null);
                  }}
                  onClose={() => setThemeEditor(null)}
                />
              )}
            </div>
          </details>

          <details className="card res-group" open={privacyOpen} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setPrivacyOpen(o); saveSectionOpen("privacy", o); }}>
            <summary className="res-group__band">
              <span className="res-group__title">Приватность</span>
            </summary>
            <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={hideFinance} onChange={(e) => changeHideFinance(e.target.checked)} />
                Скрывать коммерческую составляющую
              </label>
              <span className="muted" style={{ maxWidth: "62ch" }}>Прячет суммы заработка и ставки — удобно при демонстрации экрана.</span>
            </div>
          </details>

          <details className="card res-group" open={bagOpen} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setBagOpen(o); saveSectionOpen("bag", o); }}>
            <summary className="res-group__band">
              <span className="res-group__title">Мешок</span>
            </summary>
            <div className="res-group__body" style={{ padding: 12 }}>
              <p className="muted" style={{ maxWidth: "62ch" }}>Блок в боковой панели для временного хранения сущностей.</p>
              <label className="stack" style={{ maxWidth: 200, gap: 4 }}>
                Количество ячеек
                <input type="number" min={MIN_BAG_SIZE} max={MAX_BAG_SIZE} value={bagSize} onChange={(e) => changeBagSize(Number(e.target.value) || MIN_BAG_SIZE)} />
              </label>
            </div>
          </details>
        </div>
      )}

      {activeTab === "systems" && (
        <div className="stack" style={{ gap: 12 }}>
          <details className="card res-group" open={dndOpen} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setDndOpen(o); saveSectionOpen("dnd", o); }}>
            <summary className="res-group__band">
              <span className="res-group__title">ДнД 5.5</span>
            </summary>
            <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>

              <div className="muted" style={{ marginBottom: 4, fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Главное число на кости</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                {DND_ABILITY_PRIMARY_OPTIONS.map((opt) => (
                  <label key={opt.key} className="row" style={{ gap: 6 }}>
                    <input type="radio" name="dnd-ability-primary" checked={dndPrefs.abilityPrimary === opt.key} onChange={() => changeDndAbilityPrimary(opt.key as DndAbilityPrimary)} />
                    {opt.label}
                  </label>
                ))}
              </div>
              <div className="muted" style={{ marginBottom: 4, marginTop: 8, fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Сортировка навыков</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                {DND_SKILL_SORT_OPTIONS.map((opt) => (
                  <label key={opt.key} className="row" style={{ gap: 6 }}>
                    <input type="radio" name="dnd-skill-sort" checked={dndPrefs.skillSortMode === opt.key} onChange={() => changeDndSkillSort(opt.key as DndSkillSortMode)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </details>

          <details className="card res-group" open={pultOpen} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setPultOpen(o); saveSectionOpen("pult", o); }}>
            <summary className="res-group__band">
              <span className="res-group__title">Пульт</span>
            </summary>
            <div className="res-group__body" style={{ padding: 12 }}>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={useEpithets} onChange={(e) => changeUseEpithets(e.target.checked)} />
                Добавлять эпитеты существам с одним именем?
              </label>
              <span className="muted" style={{ maxWidth: "62ch" }}>Пяти Гоблинам — разные прилагательные (Жадный, Хромой) для различия.</span>
            </div>
          </details>
        </div>
      )}

      {activeTab === "modules" && (
        <div className="stack" style={{ gap: 12 }}>
          <ModulesTab />
        </div>
      )}

      {activeTab === "player" && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="card res-group" style={{ padding: 0 }}>
            <div className="res-group__band" style={{ cursor: "default" }}>
              <span className="res-group__title">Плеер</span>
            </div>
            <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
              <label className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Затухание между треками</span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={fadeDraft}
                  onChange={(e) => {
                    setFadeDraft(e.target.value);
                    scheduleFadeSave(e.target.value);
                  }}
                  style={{ flex: 1, maxWidth: 200 }}
                  aria-label="Затухание ползунком"
                />
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  style={{ width: 70 }}
                  value={fadeDraft}
                  onChange={(e) => { setFadeDraft(e.target.value); scheduleFadeSave(e.target.value); }}
                  onBlur={(e) => saveFadeDurationNow(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveFadeDurationNow((e.target as HTMLInputElement).value)}
                  aria-label="Затухание числом"
                />
                <span className="muted" style={{ fontSize: 12 }}>сек</span>
              </label>
              <span className="muted" style={{ maxWidth: "62ch" }}>Текущий трек затихает за это время перед следующим. 0 — резко. Сохраняется автоматически.</span>
            </div>
          </div>
        </div>
      )}

      {hasElectron && activeTab === "updates" && (
        <div className="stack" style={{ gap: 12 }}>
          <UpdateChecker />
        </div>
      )}
    </div>
  );
}
