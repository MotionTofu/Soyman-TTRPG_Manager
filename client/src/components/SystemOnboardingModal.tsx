import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "./Modal";
import type { System } from "../types";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function SystemOnboardingModal({ onClose, onCreated }: Props) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"choose" | "import" | "create" | "success">("choose");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dnd, setDnd] = useState(true);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [successId, setSuccessId] = useState<number | null>(null);

  async function handleImport(file: File) {
    setImporting(true);
    setError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const created = await api.post<System>("/systems/import", data);
      setSuccessId(created.id);
      setMode("success");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError("Название обязательно");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await api.post<System>("/systems", {
        name: name.trim(),
        description,
        template: dnd ? "dnd" : undefined,
      });
      setSuccessId(created.id);
      setMode("success");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Система</h3>

        {mode === "choose" && (
          <div className="stack" style={{ gap: 12 }}>
            <p className="muted" style={{ margin: 0 }}>
              Импортируйте готовую систему из файла экспорта, либо создайте новую.
            </p>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <button className="primary" onClick={() => setMode("import")}>
                Импорт файла
              </button>
              <button onClick={() => setMode("create")}>Создать новую</button>
              <button onClick={onClose}>Отмена</button>
            </div>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              Файл JSON
            </span>
          </div>
        )}

        {mode === "import" && (
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              Выберите JSON-файл, созданный экспортом. Система будет создана со всеми разделами и записями из файла.
            </p>
            <label className="stack editable-card-field">
              <span>Файл системы</span>
              <input
                type="file"
                accept="application/json,.json"
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImport(f);
                }}
              />
              {fileName && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{fileName}</span>}
            </label>
            {error && <span className="backup-info error">{error}</span>}
            <div className="row">
              <button onClick={() => { setMode("choose"); setError(null); }} disabled={importing}>
                Назад
              </button>
              <button onClick={onClose} disabled={importing}>
                Отмена
              </button>
            </div>
            {importing && <span className="muted">Загружается…</span>}
          </div>
        )}

        {mode === "create" && (
          <div className="stack">
            <label className="stack editable-card-field">
              <span>Название</span>
              <input
                autoFocus
                value={name}
                placeholder="Например, D&D 5.5 Homebrew"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="stack editable-card-field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={description}
                placeholder="Коротко о системе"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="row" style={{ gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={dnd} onChange={(e) => setDnd(e.target.checked)} />
              <span>Создать как D&D-подобную (пустой шаблон)</span>
            </label>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
              {dnd
                ? "Будут созданы все разделы D&D: Заклинания, Классы, Виды, Предыстории, Черты, Снаряжение, Маг. предметы, Бестиарий, Транспорт, Бастионы, Справочник с группами и шаблоны существ/персонажей — без наполнения."
                : "Будет создана пустая система с базовыми разделами Справочник и Транспорт."}
            </span>
            {error && <span className="backup-info error">{error}</span>}
            <div className="row">
              <button onClick={() => { setMode("choose"); setError(null); }} disabled={creating}>
                Назад
              </button>
              <button className="primary" disabled={!name.trim() || creating} onClick={handleCreate}>
                {creating ? "Создаю…" : "Создать"}
              </button>
              <button onClick={onClose} disabled={creating}>
                Отмена
              </button>
            </div>
          </div>
        )}

        {mode === "success" && (
          <div className="stack" style={{ gap: 12, alignItems: "center", padding: "20px 0" }}>
            <span style={{ fontSize: "var(--fs-h2)", color: "var(--success, #15803d)" }}>✓</span>
            <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: "var(--fs-meta)" }}>Успех!</span>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Система создана и загружена</span>
            <button className="primary" onClick={() => navigate(`/systems/${successId}`)}>
              Открыть систему
            </button>
            <button onClick={onClose}>Закрыть</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
