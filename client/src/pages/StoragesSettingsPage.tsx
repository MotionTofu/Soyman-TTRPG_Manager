import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ModulesTab } from "../components/ModulesTab";
import type { AppSettings, StorageProfile } from "../types";

export function StoragesSettingsPage() {
  const [activeId, setActiveId] = useState("");
  const [storages, setStorages] = useState<StorageProfile[]>([]);
  const [error, setError] = useState("");

  const [fadeDraft, setFadeDraft] = useState("0");

  function refreshAppSettings() {
    api.get<AppSettings>("/app-settings").then((s) => {
      setFadeDraft(String(Math.round(s.fade_duration_ms / 1000)));
    });
  }
  useEffect(refreshAppSettings, []);

  async function saveFadeDuration() {
    const seconds = Math.max(0, Number(fadeDraft) || 0);
    await api.put("/app-settings/fade-duration", { fade_duration_ms: seconds * 1000 });
    refreshAppSettings();
  }

  const [newName, setNewName] = useState("");
  const [newFolder, setNewFolder] = useState("");

  const [importName, setImportName] = useState("");
  const [importFolder, setImportFolder] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  function refresh() {
    api
      .get<{ activeId: string; storages: StorageProfile[] }>("/storages")
      .then((r) => {
        setActiveId(r.activeId);
        setStorages(r.storages);
      });
  }
  useEffect(refresh, []);

  async function createStorage() {
    if (!newName.trim() || !newFolder.trim()) return;
    setError("");
    try {
      await api.post("/storages", { name: newName, folderPath: newFolder });
      setNewName("");
      setNewFolder("");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function activate(id: string) {
    if (
      !confirm(
        "Переключить активное хранилище? Приложение перезагрузится и начнёт работать с выбранным хранилищем."
      )
    )
      return;
    setError("");
    try {
      await api.post(`/storages/${id}/activate`);
      window.location.reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(id: string) {
    if (!confirm("Убрать хранилище из списка? Сами файлы на диске не удаляются.")) return;
    setError("");
    try {
      await api.del(`/storages/${id}`);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function saveRename() {
    if (!renamingId || !renameDraft.trim()) return;
    await api.put(`/storages/${renamingId}`, { name: renameDraft });
    setRenamingId(null);
    refresh();
  }

  async function importBackup() {
    if (!importFile || !importName.trim() || !importFolder.trim()) return;
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
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="stack">
      <h1>Настройки</h1>

      <details className="card stack">
        <summary>
          <strong className="entry-title">Хранилище</strong>
        </summary>
        <p className="muted">
          Хранилище — это папка на диске (база данных + вейлт с файлами кампаний). Можно завести
          несколько и переключаться между ними; активно в любой момент только одно.
        </p>
        {error && <div className="backup-info error">{error}</div>}

        <div className="stack">
          {storages.map((s) => (
            <div key={s.id} className="card stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                {renamingId === s.id ? (
                  <div className="row">
                    <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} />
                    <button className="primary" onClick={saveRename}>
                      Сохранить
                    </button>
                    <button onClick={() => setRenamingId(null)}>Отмена</button>
                  </div>
                ) : (
                  <div className="row">
                    <strong>{s.name}</strong>
                    {s.id === activeId && <span className="badge tag">Активно</span>}
                  </div>
                )}
                <div className="row">
                  {s.id !== activeId && (
                    <button className="primary" onClick={() => activate(s.id)}>
                      Активировать
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setRenamingId(s.id);
                      setRenameDraft(s.name);
                    }}
                  >
                    Переименовать
                  </button>
                  {s.id !== activeId && <button onClick={() => remove(s.id)}>Убрать</button>}
                </div>
              </div>
              <div className="muted">Вейлт: {s.vaultRoot}</div>
              <div className="muted">База данных: {s.dbDir}</div>
            </div>
          ))}
        </div>

        <div className="card stack">
          <h3>Новое хранилище</h3>
          <p className="muted">
            Укажите пустую (или новую) папку — внутри неё будут созданы подпапки данных и вейлта.
          </p>
          <div className="row">
            <input
              placeholder="Название"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              placeholder="Путь к папке, например D:\RPG-Storage-2"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="primary" onClick={createStorage}>
              Создать
            </button>
          </div>
        </div>

        <div className="card stack">
          <h3>Импортировать хранилище из бэкапа</h3>
          <p className="muted">
            Файл — это zip, созданный кнопкой «Бэкап» (содержит app.db и папку RPG-Vault). Хранилище
            распакуется в указанную папку и появится в списке выше, но не станет активным
            автоматически.
          </p>
          <div className="row">
            <input
              placeholder="Название"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
            />
            <input
              placeholder="Папка назначения"
              value={importFolder}
              onChange={(e) => setImportFolder(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
            <button className="primary" onClick={importBackup} disabled={importing}>
              {importing ? "Импортирую…" : "Импортировать"}
            </button>
          </div>
        </div>
      </details>

      <details className="card stack">
        <summary>
          <strong className="entry-title">Модули</strong>
        </summary>
        <ModulesTab />
      </details>

      <details className="card stack">
        <summary>
          <strong className="entry-title">Плеер</strong>
        </summary>
        <label className="row" style={{ gap: 6 }}>
          Затухание между треками (сек)
          <input
            type="number"
            min={0}
            style={{ width: 70 }}
            value={fadeDraft}
            onChange={(e) => setFadeDraft(e.target.value)}
            onBlur={saveFadeDuration}
          />
        </label>
        <span className="muted">
          Перед переключением на следующий трек текущий плавно затихает за это время. 0 — переключение без затухания.
        </span>
      </details>
    </div>
  );
}
