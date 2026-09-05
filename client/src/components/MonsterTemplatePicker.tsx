import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useCurrentUser } from "../api/currentUser";
import type { SearchResult } from "../types";

// Compact search-and-pick control for choosing a compendium entry of one kind.
// Used for бестиарий templates ("Гоблин-воин") when creating a setting-level
// "личность", and for маг. предметы when tying an artifact to the system's
// reference entry — same control, different `kind`.
export function CompendiumEntryPicker({
  value,
  onChange,
  kind,
  placeholder,
  selectedLabel,
  dropUp,
}: {
  value: SearchResult | null;
  onChange: (entry: SearchResult | null) => void;
  kind: string;
  placeholder: string;
  selectedLabel: string;
  /**
   * Раскрывать список вверх. Нужно там, где поле стоит у нижнего края
   * содержимого — на карте персонажа подсказки уходили за экран, и выбрать
   * из них было нечего.
   */
  dropUp?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  // Мастерский /search игроку закрыт — у него свой /player/search (тот же
  // приём, что в SearchPanel). Игроцкий роут ищет по системам кампаний игрока
  // и не умеет фильтр kind — отбираем нужный вид здесь: kind у мастерского
  // ответа, subtitle у игроцкого (там лежит тот же kind записи).
  const { user } = useCurrentUser();
  const isPlayer = user?.role === "player";

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      const url = isPlayer
        ? `/player/search?q=${encodeURIComponent(query.trim())}`
        : `/search?q=${encodeURIComponent(query.trim())}&types=compendium_entry&kind=${kind}`;
      api
        .get<SearchResult[]>(url)
        .then((rows) =>
          setResults(
            isPlayer ? rows.filter((r) => r.type === "compendium_entry" && (r.kind ?? r.subtitle) === kind) : rows
          )
        )
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, kind, isPlayer]);

  if (value) {
    return (
      <span className="row" style={{ gap: 4 }}>
        <span className="muted">
          {selectedLabel}: {value.title}
        </span>
        <button type="button" onClick={() => onChange(null)}>
          ✕
        </button>
      </span>
    );
  }

  return (
    <span className="row" style={{ position: "relative", gap: 4 }}>
      <input
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div
          className="card stack"
          style={{
            position: "absolute",
            ...(dropUp ? { bottom: "100%" } : { top: "100%" }),
            left: 0,
            zIndex: 10,
            minWidth: 220,
            maxHeight: 220,
            overflowY: "auto",
            gap: 0,
            padding: 4,
          }}
        >
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="row"
              style={{ justifyContent: "flex-start", textAlign: "left" }}
              onMouseDown={() => {
                onChange(r);
                setQuery("");
                setOpen(false);
              }}
            >
              {r.title}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// Бестиарий-flavoured wrapper: the being's statblock gets cloned from the
// chosen template on creation (see settingBeings.ts POST), this control just
// needs to resolve an id+label.
export function MonsterTemplatePicker({
  value,
  onChange,
}: {
  value: SearchResult | null;
  onChange: (entry: SearchResult | null) => void;
}) {
  return (
    <CompendiumEntryPicker
      value={value}
      onChange={onChange}
      kind="monster"
      placeholder="На основе (Бестиарий)…"
      selectedLabel="На основе"
    />
  );
}
