import { useState } from "react";
import { api } from "../api/client";
import { Modal } from "./Modal";
import type { MissingFile, RelinkCandidate } from "../sound/types";

// Перепривязка пути к файлу. Общая для всех ресурсов, а не только для
// звуков: file_path есть и у карт, и у раздаток, и переехавшее хранилище
// ломает их одинаково.
//
// После того как одному файлу указали новое место, остальные пропавшие
// ищутся в той же папке по имени. Найденное НЕ применяется само — в отличие
// от After Effects: там путь очевидно один на проект, а здесь одноимённый
// файл из чужой библиотеки подменил бы звук незаметно, и обнаружилось бы это
// на игре. Поэтому список с галочками и «Отметить все».
export function RelinkModal({
  target,
  onClose,
  onDone,
}: {
  target: MissingFile;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newPath, setNewPath] = useState("");
  const [candidates, setCandidates] = useState<RelinkCandidate[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (!newPath.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ ok: boolean; candidates: RelinkCandidate[] }>("/files/relink", {
        resource_id: target.resource_id,
        new_path: newPath.trim(),
      });
      setCandidates(result.candidates);
      // Уверенные совпадения отмечены заранее, «только имя» — нет: отметку
      // на сомнительном пусть ставит человек.
      setChecked(
        new Set(
          result.candidates.filter((c) => c.match === "name_and_size").map((c) => c.resource_id)
        )
      );
      if (result.candidates.length === 0) {
        onDone();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "не удалось привязать файл");
    } finally {
      setBusy(false);
    }
  }

  async function applyBatch() {
    if (!candidates) return;
    setBusy(true);
    try {
      await api.post("/files/relink-batch", {
        items: candidates
          .filter((c) => checked.has(c.resource_id))
          .map((c) => ({ resource_id: c.resource_id, new_path: c.new_path })),
      });
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>Файл не найден</h3>
      <div className="stack">
        <div>
          <strong>{target.name}</strong>
          <div className="muted" style={{ textDecoration: "line-through", wordBreak: "break-all" }}>
            {target.file_path}
          </div>
        </div>

        {!candidates ? (
          <>
            <label className="stack">
              <span className="muted">Новый путь к файлу</span>
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder={`…\\${target.file_name}`}
              />
            </label>
            <p className="muted">
              Путь может быть и вне хранилища — копировать библиотеку звуков внутрь незачем.
            </p>
            {error ? <p style={{ color: "var(--accent)" }}>{error}</p> : null}
            <div className="row">
              <button className="primary" onClick={apply} disabled={busy || !newPath.trim()}>
                Привязать
              </button>
              <button onClick={onClose}>Отмена</button>
            </div>
          </>
        ) : (
          <>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>В этой же папке нашлись ещё</strong>
              <span className="row">
                <button onClick={() => setChecked(new Set(candidates.map((c) => c.resource_id)))}>
                  Отметить все
                </button>
                <button onClick={() => setChecked(new Set())}>Снять все</button>
              </span>
            </div>
            <div className="stack">
              {candidates.map((c) => (
                <label key={c.resource_id} className="row" style={{ alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={checked.has(c.resource_id)}
                    onChange={() => toggle(c.resource_id)}
                  />
                  <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <div>{c.file_name}</div>
                    <div className="muted">{c.name}</div>
                  </span>
                  <span className="badge" style={c.match === "name_only" ? { color: "var(--accent)" } : undefined}>
                    {c.match === "name_and_size" ? "имя + размер" : "только имя"}
                  </span>
                </label>
              ))}
            </div>
            <p className="muted">
              Совпадение по имени файла может ошибиться, поэтому пути обновляются только по отметке.
            </p>
            <div className="row">
              <button className="primary" onClick={applyBatch} disabled={busy}>
                Обновить пути · {checked.size + 1}
              </button>
              <button
                onClick={() => {
                  onDone();
                  onClose();
                }}
              >
                Не сейчас
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
