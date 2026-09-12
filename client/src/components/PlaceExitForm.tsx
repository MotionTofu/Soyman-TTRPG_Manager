import { useId, useMemo, useState } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { locationRoleIcon } from "../locationRoles";
import type { SettingLocation } from "../types";
import { NavIcon } from "./NavIcons";

// Подсказки к «как»: свободный текст остаётся — «подводный грот, только в
// отлив» тоже выход (решения 2026-09-11, §4, Q15).
const HOW_SUGGESTIONS = ["дорога", "тропа", "тайный ход", "портал", "дверь", "вода"];
const MAX_OPTIONS = 8;

function norm(s: string): string {
  return s.toLocaleLowerCase("ru").replace(/ё/g, "е");
}

/** Новый выход из места: куда (поиск по местам сеттинга с путём), как, время, флаги. */
export function PlaceExitForm({
  settingId,
  fromId,
  onClose,
}: {
  settingId: number;
  fromId: number;
  onClose: () => void;
}) {
  const { data: locations, loading } = useResource<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`);
  const run = useAction();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<SettingLocation | null>(null);
  const [cursor, setCursor] = useState(0);
  const [how, setHow] = useState("");
  const [travel, setTravel] = useState("");
  const [oneWay, setOneWay] = useState(false);
  const [secret, setSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map((locations ?? []).map((l) => [l.id, l])), [locations]);

  // Путь без самого места: одноимённые «Зал» в разных данжах различимы.
  function pathOf(l: SettingLocation): string {
    const names: string[] = [];
    const seen = new Set<number>([l.id]);
    let cur = l.parent_id != null ? byId.get(l.parent_id) : undefined;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    }
    return names.join(" / ");
  }

  const options = useMemo(() => {
    const q = norm(query.trim());
    if (!q || target) return [];
    const matches = (locations ?? []).filter((l) => {
      if (l.archived_at || l.id === fromId) return false;
      const aliases = Array.isArray(l.aliases) ? l.aliases : [];
      return norm(l.name).includes(q) || aliases.some((a) => norm(String(a)).includes(q));
    });
    matches.sort((a, b) => {
      const ap = norm(a.name).startsWith(q) ? 0 : 1;
      const bp = norm(b.name).startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name, "ru", { numeric: true });
    });
    return matches.slice(0, MAX_OPTIONS);
  }, [query, target, locations, fromId]);

  async function submit() {
    if (!target || saving) return;
    setSaving(true);
    const created = await run(
      () =>
        write.post(`/setting-locations/${fromId}/exits`, {
          to_location_id: target.id,
          how: how.trim(),
          travel_time: travel.trim(),
          one_way: oneWay,
          secret,
        }),
      {
        affects: [
          { kind: "location", id: fromId },
          { kind: "location", id: target.id },
        ],
        retry: false,
      }
    );
    setSaving(false);
    if (created !== undefined) onClose();
  }

  return (
    <div
      className="exit-form"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="exit-form__field">
        <span className="place-card__title">Куда</span>
        {target ? (
          <div className="exit-form__picked">
            <NavIcon name={locationRoleIcon(target)} />
            <span className="exit-form__picked-name">{target.name}</span>
            <span className="place-card__note">{pathOf(target)}</span>
            <button
              type="button"
              className="comp-mini"
              style={{ marginLeft: "auto" }}
              onClick={() => {
                setTarget(null);
                setQuery("");
              }}
              aria-label="Выбрать другое место"
              title="Выбрать другое место"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="exit-form__combo">
            <input
              autoFocus
              className="exit-form__input"
              role="combobox"
              aria-label="Куда ведёт выход"
              aria-expanded={options.length > 0}
              aria-controls={listId}
              placeholder={loading ? "Загрузка мест…" : "Название места"}
              value={query}
              disabled={saving}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, options.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === "Enter" && options[cursor]) {
                  e.preventDefault();
                  setTarget(options[cursor]);
                }
              }}
            />
            {options.length > 0 && (
              <div className="exit-form__options" role="listbox" id={listId}>
                {options.map((o, i) => {
                  const path = pathOf(o);
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === cursor}
                      key={o.id}
                      className={`exit-form__option${i === cursor ? " is-active" : ""}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setTarget(o)}
                    >
                      <span className="exit-form__option-name">{o.name}</span>
                      {path && <span className="exit-form__option-path">{path}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {query.trim() && !loading && options.length === 0 && <span className="muted">Такого места нет</span>}
          </div>
        )}
      </div>

      <div className="exit-form__field">
        <span className="place-card__title">Как</span>
        <input
          className="exit-form__input"
          aria-label="Как пройти"
          placeholder="дорога, тайный ход, портал…"
          value={how}
          maxLength={200}
          disabled={saving}
          onChange={(e) => setHow(e.target.value)}
        />
        <div className="exit-form__chips">
          {HOW_SUGGESTIONS.map((s) => (
            <button
              type="button"
              key={s}
              className={`exit-form__chip${how.trim() === s ? " is-active" : ""}`}
              onClick={() => setHow(s)}
              disabled={saving}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="exit-form__field">
        <span className="place-card__title">Время в пути</span>
        <input
          className="exit-form__input"
          aria-label="Время в пути"
          placeholder="например, полдня"
          value={travel}
          maxLength={100}
          disabled={saving}
          onChange={(e) => setTravel(e.target.value)}
        />
      </div>

      <div className="exit-form__flags">
        <label>
          <input type="checkbox" checked={oneWay} onChange={(e) => setOneWay(e.target.checked)} disabled={saving} />
          Только туда
        </label>
        <label>
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} disabled={saving} />
          Тайный
        </label>
      </div>

      <div className="exit-form__actions">
        <button className="primary" onClick={() => void submit()} disabled={!target || saving}>
          {saving ? "…" : "Добавить выход"}
        </button>
        <button type="button" onClick={onClose} disabled={saving}>
          Отмена
        </button>
      </div>
    </div>
  );
}
