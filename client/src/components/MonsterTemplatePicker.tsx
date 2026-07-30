import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { SearchResult } from "../types";

// Compact search-and-pick control for choosing a system Бестиарий template
// ("Гоблин-воин") when creating a setting-level "личность" — the being's
// statblock gets cloned from the chosen template on creation (see
// settingBeings.ts POST), this component just needs to resolve an id+label.
export function MonsterTemplatePicker({
  value,
  onChange,
}: {
  value: SearchResult | null;
  onChange: (entry: SearchResult | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<SearchResult[]>(
          `/search?q=${encodeURIComponent(query.trim())}&types=compendium_entry&kind=monster`
        )
        .then(setResults);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  if (value) {
    return (
      <span className="row" style={{ gap: 4 }}>
        <span className="muted">На основе: {value.title}</span>
        <button type="button" onClick={() => onChange(null)}>
          ✕
        </button>
      </span>
    );
  }

  return (
    <span className="row" style={{ position: "relative", gap: 4 }}>
      <input
        placeholder="На основе (Бестиарий)…"
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
            top: "100%",
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
