import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Module } from "../types";

// "Модули" — toggleable Systems/Settings. Existing (non-imported) rows are
// auto-wrapped server-side so everything shows in one list; enabling an
// imported module materializes it (creates the actual system/setting),
// disabling archives it — the underlying data is never deleted by a toggle.
export function ModulesTab() {
  const [modules, setModules] = useState<Module[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  function refresh() {
    api.get<Module[]>("/modules").then(setModules);
  }
  useEffect(refresh, []);

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
    setImporting(true);
    setError("");
    try {
      const text = await file.text();
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

  const systemModules = modules.filter((m) => m.type === "system");
  const settingModules = modules.filter((m) => m.type === "setting");

  function renderRow(mod: Module) {
    const link = mod.system_id ? `/systems/${mod.system_id}` : mod.setting_id ? `/settings/${mod.setting_id}` : null;
    return (
      <div key={mod.id} className="row" style={{ justifyContent: "space-between" }}>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={!!mod.enabled} onChange={() => toggle(mod)} />
          {link ? <Link to={link}>{mod.name}</Link> : <span>{mod.name}</span>}
          {mod.source === "imported" && <span className="badge tag">импортирован</span>}
        </label>
        <button onClick={() => remove(mod)} title="В архив">
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        Подключаемые Системы и Сеттинги — включи галочкой, чтобы данные появились в приложении;
        выключи, чтобы убрать их из активных разделов, не удаляя. Экспортированный файл (кнопка
        «Экспорт» на странице системы/сеттинга) можно добавить сюда как новый модуль.
      </p>
      {error && <div className="backup-info error">{error}</div>}

      <div className="row">
        <label className="row" style={{ cursor: "pointer" }}>
          {importing ? "Загрузка…" : "+ Добавить модуль из файла"}
          <input
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <div>
        <h3>Системы</h3>
        <div className="stack">
          {systemModules.map(renderRow)}
          {systemModules.length === 0 && <p className="muted">Пока нет систем.</p>}
        </div>
      </div>

      <div>
        <h3>Сеттинги</h3>
        <div className="stack">
          {settingModules.map(renderRow)}
          {settingModules.length === 0 && <p className="muted">Пока нет сеттингов.</p>}
        </div>
      </div>
    </div>
  );
}
