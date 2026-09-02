import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { SettingWizard } from "./SettingWizard";
import type { Setting } from "../types";

interface Props {
  onClose: () => void;
  onRefresh: () => void;
}

export function SettingOnboardingModal({ onClose, onRefresh }: Props) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"choose" | "import" | "success">("choose");
  const [showWizard, setShowWizard] = useState(false);
  const [importing, setImporting] = useState(false);
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
      const created = await api.post<Setting>("/settings/import", data);
      setSuccessId(created.id);
      setMode("success");
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  if (showWizard) {
    return (
      <SettingWizard
        onClose={() => {
          setShowWizard(false);
          onRefresh();
          onClose();
        }}
      />
    );
  }

  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Сеттинг</h3>

        {mode === "choose" && (
          <div className="stack" style={{ gap: 12 }}>
            <p className="muted" style={{ margin: 0 }}>
              Импортируйте готовый сеттинг из файла экспорта, либо создайте новый.
            </p>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <button className="primary" onClick={() => setMode("import")}>
                Импорт файла
              </button>
              <button onClick={() => setShowWizard(true)}>Создать новый</button>
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
              Выберите JSON-файл, созданный экспортом. Сеттинг будет создан со всеми локациями, персонами и связями из файла.
            </p>
            <label className="stack editable-card-field">
              <span>Файл сеттинга</span>
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

        {mode === "success" && (
          <div className="stack" style={{ gap: 12, alignItems: "center", padding: "20px 0" }}>
            <span style={{ fontSize: "var(--fs-h2)", color: "var(--success, #15803d)" }}>✓</span>
            <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: "var(--fs-meta)" }}>Успех!</span>
            <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Сеттинг создан и загружен</span>
            <button className="primary" onClick={() => navigate(`/settings/${successId}`)}>
              Открыть сеттинг
            </button>
            <button onClick={onClose}>Закрыть</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
