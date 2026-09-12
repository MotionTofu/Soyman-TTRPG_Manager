import { useState } from "react";
import { api } from "../api/client";
import type { LocationContentItem } from "../types";

// Наполнение «что внутри» (план «Зоны локаций», этап 6): секрет, лут,
// ловушка, особенность. Лёгкие строки без файлов и связей — дерево = где,
// наполнение = что. Переиспользуется и на карточке точки, и в строках
// «Плана» родителя (там — те же данные через GET /:id/plan).
const KINDS = [
  { key: "secret", label: "Секрет" },
  { key: "loot", label: "Лут" },
  { key: "trap", label: "Ловушка" },
  { key: "feature", label: "Особенность" },
] as const;

type ContentKind = (typeof KINDS)[number]["key"];

const KIND_LABEL: Record<ContentKind, string> = {
  secret: "Секреты",
  loot: "Лут",
  trap: "Ловушки",
  feature: "Особенности",
};

export function LocationContent({
  locationId,
  items,
  onChange,
  readOnly = false,
}: {
  locationId: number;
  items: LocationContentItem[];
  onChange: () => void;
  /** Режим чтения: список без формы добавления и кнопок удаления. */
  readOnly?: boolean;
}) {
  const [kind, setKind] = useState<ContentKind>("secret");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const clean = text.trim();
    if (!clean || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/setting-locations/${locationId}/content`, { kind, text: clean });
      setText("");
      onChange();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      await api.del(`/setting-locations/content/${id}`);
      onChange();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {KINDS.map(({ key }) => {
        const rows = items.filter((i) => i.kind === key);
        if (rows.length === 0) return null;
        return (
          <div key={key}>
            <div className="muted" style={{ fontSize: "var(--fs-micro)", fontFamily: "var(--font-ui)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {KIND_LABEL[key]} ({rows.length})
            </div>
            {rows.map((r) => (
              <div key={r.id} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                <span style={{ flex: 1, minWidth: 0 }}>{r.text}</span>
                {!readOnly && (
                  <button onClick={() => remove(r.id)} title="Убрать" aria-label={`Убрать: ${r.text.slice(0, 40)}`}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {error && <span style={{ color: "var(--status-cancelled)" }}>{error}</span>}
      {!readOnly && (
        <div className="row" style={{ gap: 8 }}>
          <select value={kind} onChange={(e) => setKind(e.target.value as ContentKind)} disabled={saving} title="Тип">
            {KINDS.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <input
            placeholder="Тайник под третьей плитой…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            disabled={saving}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button className="primary" onClick={add} disabled={saving || !text.trim()}>
            {saving ? "…" : "Добавить"}
          </button>
        </div>
      )}
      {readOnly && items.length === 0 && <span className="muted">Пусто</span>}
    </div>
  );
}
