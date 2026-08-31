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
  const [mode, setMode] = useState<"choose" | "import">("choose");
  const [showWizard, setShowWizard] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

  async function handleImport(file: File) {
    setImporting(true);
    setError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const created = await api.post<Setting>("/settings/import", data);
      onRefresh();
      onClose();
      navigate(`/settings/${created.id}`);
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
      <div className="stack" style={{ minWidth: 420 }}>
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
            </div>
            <span className="muted" style={{ fontSize: 11 }}>
              Файл — это JSON, полученный экспортом сеттинга (кнопка Экспорт на странице сеттинга).
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
              {fileName && <span className="muted" style={{ fontSize: 11 }}>{fileName}</span>}
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
            {importing && <span className="muted">Импортирую… файл может весить до 500+ МБ, подождите</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}
