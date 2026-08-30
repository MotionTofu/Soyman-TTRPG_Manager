import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { refreshMentionIndex } from "../mentions";
import type { Module, ModuleCatalogEntry } from "../types";

// "Модули" — toggleable Systems/Settings. Existing (non-imported) rows are
// auto-wrapped server-side so everything shows in one list; enabling an
// imported module materializes it (creates the actual system/setting),
// disabling archives it — the underlying data is never deleted by a toggle.
export function ModulesTab() {
  const [modules, setModules] = useState<Module[]>([]);
  const [importing, setImporting] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [catalog, setCatalog] = useState<ModuleCatalogEntry[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogBusyId, setCatalogBusyId] = useState<string | null>(null);

  function refresh() {
    api.get<Module[]>("/modules").then(setModules);
    // Установка, включение, обновление и удаление модуля меняют состав
    // сущностей пачкой — а по карте глобальных ключей ссылки в текстах решают,
    // куда ведут. Без перечитывания только что поставленный модуль оживил бы
    // ссылки на себя лишь после перезапуска приложения.
    void refreshMentionIndex();
  }
  useEffect(refresh, []);

  async function refreshCatalog() {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      setCatalog(await api.get<ModuleCatalogEntry[]>("/modules/catalog"));
    } catch (e) {
      setCatalogError(String(e));
    } finally {
      setCatalogLoading(false);
    }
  }

  async function installFromCatalog(entry: ModuleCatalogEntry) {
    setCatalogBusyId(entry.remoteId);
    setCatalogError("");
    try {
      await api.post(`/modules/catalog/${entry.remoteId}/install`);
      refresh();
      await refreshCatalog();
    } catch (e) {
      setCatalogError(String(e));
    } finally {
      setCatalogBusyId(null);
    }
  }

  async function updateFromCatalog(entry: ModuleCatalogEntry) {
    setCatalogBusyId(entry.remoteId);
    setCatalogError("");
    try {
      const result = await api.post<{ backup: { name: unknown }; summary: Record<string, number> }>(
        `/modules/catalog/${entry.remoteId}/update`
      );
      const parts = Object.entries(result.summary)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${v}`);
      alert(`Готово, «${entry.name}» обновлён.` + (parts.length ? `\n\n${parts.join("\n")}` : ""));
      refresh();
      await refreshCatalog();
    } catch (e) {
      setCatalogError(String(e));
    } finally {
      setCatalogBusyId(null);
    }
  }

  async function toggle(mod: Module) {
    setError("");
    try {
      await api.put(`/modules/${mod.id}/${mod.enabled ? "disable" : "enable"}`);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(mod: Module) {
    const materialized = mod.system_id != null || mod.setting_id != null;
    const message = materialized
      ? `Отправить «${mod.name}» в Архив? Данные сохранятся — восстановить или удалить навсегда можно на странице «Архив».`
      : `Убрать импортированный модуль «${mod.name}» из списка? Он не был включён, данные нигде не созданы.`;
    if (!confirm(message)) return;
    await api.del(`/modules/${mod.id}`);
    refresh();
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      setError("Файл слишком большой — лимит 200 МБ");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const text = await file.text();
      if (text.includes("__proto__") || text.includes("\"constructor\"")) throw new Error("Недопустимое содержимое");
      const data = JSON.parse(text);
      const type = data.sections && data.entries ? "system" : data.locations && data.communities ? "setting" : null;
      if (!type) throw new Error("Файл не похож на экспорт системы или сеттинга.");
      await api.post("/modules/import", { type, data });
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }

  // "Обновить" merges a newer export INTO the already-materialized system/
  // setting in place (matched by name/name-path, so existing ids — and
  // anything that links to them — survive), instead of creating a duplicate
  // like "+ Добавить модуль из файла" does. The server always snapshots an
  // archived backup of the current state first, so a bad merge is one
  // restore away on the Archive page.
  async function handleUpdateFile(mod: Module, file: File | null) {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      setError("Файл слишком большой — лимит 200 МБ");
      return;
    }
    setUpdatingId(mod.id);
    setError("");
    try {
      const text = await file.text();
      if (text.includes("__proto__") || text.includes("\"constructor\"")) throw new Error("Недопустимое содержимое");
      const data = JSON.parse(text);
      const endpoint = mod.type === "system" ? `/systems/${mod.system_id}/update` : `/settings/${mod.setting_id}/update`;
      const result = await api.post<{
        backup: { name: string };
        summary: Record<string, number>;
      }>(endpoint, data);
      const parts = Object.entries(result.summary)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${v}`);
      alert(
        `Готово. Резервная копия сохранена в Архиве как «${result.backup.name}».` +
          (parts.length ? `\n\n${parts.join("\n")}` : "")
      );
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setUpdatingId(null);
    }
  }

  const systemModules = modules.filter((m) => m.type === "system");
  const settingModules = modules.filter((m) => m.type === "setting");

  function renderRow(mod: Module) {
    const link = mod.system_id ? `/systems/${mod.system_id}` : mod.setting_id ? `/settings/${mod.setting_id}` : null;
    const materialized = mod.system_id != null || mod.setting_id != null;
    return (
      <div key={mod.id} className="row" style={{ justifyContent: "space-between" }}>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={!!mod.enabled} onChange={() => toggle(mod)} />
          {link ? <Link to={link}>{mod.name}</Link> : <span>{mod.name}</span>}
          {mod.source === "imported" && <span className="badge tag">импортировано</span>}
        </label>
        <span className="row" style={{ gap: 4 }}>
          {materialized && (
            <label className="row" style={{ cursor: "pointer", gap: 4 }} title="Обновить из нового файла экспорта">
              {updatingId === mod.id ? "Обновление…" : "⟳ Обновить"}
              <input
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                disabled={updatingId !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  handleUpdateFile(mod, file);
                }}
              />
            </label>
          )}
          <button onClick={() => remove(mod)} title="В архив">
            ✕
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <details className="card res-group" open>
        <summary className="res-group__band">
          <span className="res-group__title">Общее</span>
          <span className="res-group__count">2</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12, gap: 12, display: "flex", flexDirection: "column" }}>
          <p className="muted" style={{ margin: 0 }}>
            Подключаемые Системы и Сеттинги — включи галочкой, чтобы данные появились; выключи, чтобы убрать из активных разделов, не удаляя. Файл экспорта — кнопка «Экспорт» на странице системы/сеттинга.
          </p>
          {error && <div className="backup-info error">{error}</div>}
          <div className="row">
            <label className="row" style={{ cursor: "pointer" }}>
              {importing ? "Загрузка…" : "+ Добавить модуль из файла"}
              <input type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div className="stack" style={{ gap: 8, borderTop: "1.5px solid var(--line)", paddingTop: 12 }}>
            <p className="muted" style={{ margin: 0 }}>Каталог на GitHub — курируется вручную.</p>
            <div className="row">
              <button onClick={refreshCatalog} disabled={catalogLoading}>
                {catalogLoading ? "Загрузка…" : "Обновить каталог из GitHub"}
              </button>
            </div>
            {catalogError && <div className="backup-info error">{catalogError}</div>}
            {catalog && catalog.length === 0 && <p className="muted">Каталог пуст.</p>}
            {catalog && catalog.length > 0 && (
              <div className="stack">
                {catalog.map((entry) => (
                  <div key={entry.remoteId} className="row" style={{ justifyContent: "space-between" }}>
                    <span className="row" style={{ gap: 8 }}>
                      <span>{entry.name}</span>
                      <span className="badge tag">v{entry.version}</span>
                      <span className="badge tag">{entry.type === "system" ? "система" : "сеттинг"}</span>
                    </span>
                    {entry.tooOld ? (
                      <span className="muted">Нужна версия {entry.minAppVersion} или новее</span>
                    ) : entry.installedModuleId == null ? (
                      <button onClick={() => installFromCatalog(entry)} disabled={catalogBusyId !== null}>
                        {catalogBusyId === entry.remoteId ? "Установка…" : "⬇ Установить"}
                      </button>
                    ) : entry.updateAvailable ? (
                      <button onClick={() => updateFromCatalog(entry)} disabled={catalogBusyId !== null}>
                        {catalogBusyId === entry.remoteId ? "Обновление…" : "⟳ Доступно обновление"}
                      </button>
                    ) : (
                      <span className="muted">✓ Установлено</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </details>

      <details className="card res-group">
        <summary className="res-group__band">
          <span className="res-group__title">Системы</span>
          <span className="res-group__count">{systemModules.length}</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12 }}>
          <div className="stack">
            {systemModules.map(renderRow)}
            {systemModules.length === 0 && <p className="muted">Пока нет систем.</p>}
          </div>
        </div>
      </details>

      <details className="card res-group">
        <summary className="res-group__band">
          <span className="res-group__title">Сеттинги</span>
          <span className="res-group__count">{settingModules.length}</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12 }}>
          <div className="stack">
            {settingModules.map(renderRow)}
            {settingModules.length === 0 && <p className="muted">Пока нет сеттингов.</p>}
          </div>
        </div>
      </details>
    </div>
  );
}
