import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "./mentions/MentionText";
import { DndCreatureView, normalizeDndCreature } from "./dnd/DndCreatureForm";
import type { CompendiumEntry, Statblock } from "../types";

// Мини-карточка транспорта — быстрый взгляд на судно с плитки раздела
// (вариант V1 плана реструктуризации). Той же рукой, что CreatureCardPreview:
// вкладка «Статблок» подменяет содержимое модалки статблоком вместо второй
// модалки поверх первой (приём statblockInline).
//
// Сводка и правка живут на странице судна — карточка только показывает то,
// что уже есть в entry.data (КД/хиты — канон сводки, см. E4: статблок —
// отдельный боевой лист и может отличаться).

export function VehicleCardPreview({
  id,
  onClose,
  statblockInline,
  autoShowStatblock,
}: {
  id: number;
  onClose?: () => void;
  statblockInline?: boolean;
  autoShowStatblock?: boolean;
}) {
  const [entry, setEntry] = useState<CompendiumEntry | null | undefined>(undefined);
  const [statblock, setStatblock] = useState<Statblock | null>(null);
  const [showStatblock, setShowStatblock] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntry(undefined);
    setStatblock(null);
    setShowStatblock(false);
    api
      .get<CompendiumEntry>(`/systems/entries/${id}`)
      .then((e) => {
        if (!cancelled) setEntry(e);
      })
      .catch(() => {
        if (!cancelled) setEntry(null);
      });
    api
      .get<Statblock[]>(`/statblocks?owner_type=compendium_entry&owner_id=${id}`)
      .then((rows) => {
        if (cancelled) return;
        const dnd = rows.find((s) => s.format === "dnd_creature");
        if (dnd) setStatblock(dnd);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Кнопка «Статблок» плитки открывает статблок отдельной кнопкой, минуя
  // карточку. Судно без статблока при этом остаётся на карточке (она и
  // объясняет, что заполнить, — вместо модалки, которая открылась пустой).
  useEffect(() => {
    if (autoShowStatblock && statblock) setShowStatblock(true);
  }, [autoShowStatblock, statblock]);

  if (entry === undefined) return <span className="muted">Загрузка…</span>;
  if (entry === null) return <span className="muted">Не найдено.</span>;

  if (showStatblock && statblock) {
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(statblock.content || "{}");
    } catch {
      parsed = {};
    }
    return (
      <div className="stack">
        <button type="button" className="comp-mini" onClick={() => setShowStatblock(false)}>
          ← Карточка
        </button>
        <DndCreatureView value={normalizeDndCreature(parsed)} />
      </div>
    );
  }

  const data = entry.data ?? {};
  const str = (k: string) => {
    const v = data[k];
    return v == null || v === "" ? "" : String(v);
  };
  const category = str("category");
  const size = str("size");
  const ac = str("ac");
  const hp = str("hp");
  const facts: [string, string][] = (
    [
      ["Скорость", str("speed")],
      ["Экипаж", str("crew")],
      ["Пассажиры", str("passengers")],
      ["Груз", str("cargo")],
      ["Стоимость", str("cost")],
      ["Порог урона", str("damage_threshold")],
    ] as [string, string][]
  ).filter(([, v]) => v !== "");

  return (
    <div className="creature-card">
      <div className="creature-card__band">
        {entry.avatar_image_url ? (
          <img className="creature-card__portrait" src={entry.avatar_image_url} alt="" />
        ) : (
          <span className="creature-card__portrait creature-card__portrait--empty" aria-hidden="true" />
        )}
        <div className="creature-card__title">
          <div className="creature-card__name">{entry.name || "Без названия"}</div>
          <div className="creature-card__cr">
            КД {ac || "—"} · {hp ? `${hp} хитов` : "хитов —"}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            className="creature-card__close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ✕
          </button>
        )}
      </div>

      {(category || size) && (
        <div className="creature-card__chips">
          {category && <span className="creature-card__chip is-type">{category}</span>}
          {size && <span className="creature-card__chip is-size">{size}</span>}
        </div>
      )}

      <div className="creature-card__section-body">
        {facts.length > 0 && (
          <div className="creature-card__rows">
            {facts.map(([label, value]) => (
              <div key={label} className="creature-card__row">
                <span className="creature-card__label">{label}</span>
                <span className="creature-card__value">{value}</span>
              </div>
            ))}
          </div>
        )}
        {entry.description.trim() !== "" && (
          <div className="stack" style={{ gap: 2 }}>
            <span className="creature-card__label">Описание</span>
            <MentionText text={entry.description} />
          </div>
        )}
      </div>

      <div className="creature-card__actions">
        {statblock && statblockInline && (
          <button type="button" className="creature-card__button" onClick={() => setShowStatblock(true)}>
            Статблок
          </button>
        )}
        <Link to={`/compendium/${entry.id}`} className="creature-card__button">
          Профиль
        </Link>
      </div>
    </div>
  );
}