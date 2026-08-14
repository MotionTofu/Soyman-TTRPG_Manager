import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api/client";

interface LabelSuggestion {
  label: string;
  uses: number;
}

// Ввод названия отношения с подсказкой по уже заведённым словам: «друж» →
// «дружба». Словарь общий на всё приложение и выводится из самих связей
// (см. GET /entity-relations/labels), поэтому пополняется сам собой — каждое
// новое название сразу становится подсказкой в следующий раз.
export function RelationLabelInput({
  value,
  onChange,
  placeholder = "например: любит, ненавидит, должен денег",
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<LabelSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Подсказка не должна выскакивать обратно сразу после выбора слова: тот же
  // текст в поле снова нашёл бы его в словаре.
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const query = value.trim();
    if (!query) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<LabelSuggestion[]>(`/entity-relations/labels?q=${encodeURIComponent(query)}`)
        .then((rows) => {
          // Ровно то, что уже набрано, подсказывать не о чем.
          const useful = rows.filter((r) => r.label.toLocaleLowerCase() !== query.toLocaleLowerCase());
          setSuggestions(useful);
          setHighlighted(0);
          setOpen(useful.length > 0);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [value]);

  function pick(label: string) {
    justPicked.current = true;
    onChange(label);
    setOpen(false);
    setSuggestions([]);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    const input = e.currentTarget;
    const caretAtEnd =
      input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(suggestions[highlighted].label);
      // Стрелка вправо принимает подсказку только в конце строки — иначе
      // сломалось бы обычное перемещение по уже набранному тексту.
    } else if (e.key === "ArrowRight" && caretAtEnd) {
      e.preventDefault();
      pick(suggestions[highlighted].label);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <span className="relation-label-input">
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(suggestions.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && suggestions.length > 0 && (
        <div className="entity-search-results">
          {suggestions.map((s, i) => (
            <div
              key={s.label}
              className={`entity-search-item${i === highlighted ? " highlighted" : ""}`}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s.label)}
            >
              {s.label}
              {s.uses > 1 && <span className="muted"> · {s.uses}</span>}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
