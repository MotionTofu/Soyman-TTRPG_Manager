import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { compendiumPaths } from "../../../data/compendiumEntries";
import { resourceQuery, useEntity, useResource } from "../../../data/hooks";
import { linksPath } from "../../../data/sessions";
import { statblockListPath } from "../../../data/statblocks";
import type { Character, CompendiumEntry, SessionUnionRow, Statblock, SystemSection } from "../../../types";
import { Tag } from "../LitmBook";
import { storeOf } from "../litmStore";
import { giveTreasure, treasureTheme, treasuresOf } from "../litmTreasury";
import { findLitmSheet, giveBackpackTag, type patchLitmSheet } from "./litmSheetWrite";

const NO_ENTRIES: CompendiumEntry[] = [];
const NO_SECTIONS: SystemSection[] = [];
const TIERS = [1, 2, 3, 4, 5, 6];
/** Статус платы монетой (кн. I, «Монеты», с. 137). */
const PAY = "при-деньгах";

type Sheet = typeof patchLitmSheet;
type PickMenu = (e: MouseEvent, items: { label: string; onClick: () => void }[]) => void;

/**
 * Шторка «Награды» пульта «Вызовы» (пульт v2, Q9, Q16; доска Litm-Pult-Rewards):
 * сокровища, положенные в панель к сессии, — сюжетной темой; награды книги —
 * тегом в рюкзак; плата — статусом «при-деньгах».
 */
export function LitmRewardsDrawer({
  sessionId,
  systemId,
  heroes,
  union,
  sheet,
  onPay,
  onPick,
  onClose,
}: {
  sessionId: number;
  systemId: number;
  heroes: Character[];
  union: SessionUnionRow[];
  sheet: Sheet;
  onPay: (heroIds: number[], tier: number) => void;
  onPick: PickMenu;
  onClose: () => void;
}) {
  const sections = useResource<SystemSection[]>(compendiumPaths.sections(systemId)).data ?? NO_SECTIONS;
  const storeSection = sections.find((s) => s.kind === "mechanic_backpack_category");
  const treasurySection = sections.find((s) => s.kind === "treasure");
  const storeEntries = useResource<CompendiumEntry[]>(storeSection ? compendiumPaths.sectionEntries(systemId, storeSection.id) : null).data ?? NO_ENTRIES;
  const rewards = useMemo(() => storeOf(storeEntries).rewards, [storeEntries]);
  const sheets = useQueries({
    queries: heroes.map((hero) => resourceQuery<Statblock[]>(statblockListPath("character", hero.id))),
  });
  const recipients = heroes.filter((_, index) => findLitmSheet(sheets[index].data));
  const canGive = recipients.length > 0;
  const links = useResource<{ to_type: string; to_id: number }[]>(linksPath("session", sessionId, "loot")).data;
  const ids = useMemo(() => {
    const all = [...(links ?? []), ...union.filter((u) => u.panel === "loot")].filter((l) => l.to_type === "compendium_entry").map((l) => l.to_id);
    return [...new Set(all)];
  }, [links, union]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop, .context-menu")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Все виды наград записываются в лист LitM. */
  const give = (e: MouseEvent, what: string, fields: Parameters<typeof patchLitmSheet>[2]) =>
    onPick(
      e,
      recipients.map((h) => ({ label: h.character_name, onClick: () => void sheet(h.id, `${h.character_name}: + ${what}`, fields) }))
    );

  return (
    <aside className="lp-grim lp-rw" aria-label="Награды">
      <header>
        <h2>Награды</h2>
        <span className="lp-mono">за выигранную сцену</span>
        <button type="button" className="d-btn d-btn--sm lp-rw__x" aria-label="Закрыть награды" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="lp-grim__body litm-book">
        {!canGive && (
          <p className="lb-empty">
            {sheets.some((query) => query.isPending) ? "Загружаю листы героев…" :
              sheets.some((query) => query.isError) ? "Не удалось загрузить листы героев." : "За столом нет героев с листом LitM."}
          </p>
        )}
        <section className="lp-rw__sec">
          <div className="lb-lbl">
            К сессии<small>сокровища, положенные в панель «Награды» при подготовке</small>
          </div>
          {ids.length === 0 && <p className="lb-empty">Пусто — перетащите сокровище из Сокровищницы в панель «Награды».</p>}
          {ids.map((id) => (
            <SessionTreasure key={id} id={id} onGive={give} canGive={canGive} />
          ))}
        </section>

        {rewards && rewards.groups.length > 0 && <BookRewards groups={rewards.groups} page={rewards.page} onGive={give} canGive={canGive} />}

        <Pay heroes={recipients} onPay={onPay} />

        <div className="lp-rw__links">
          {treasurySection && (
            <Link className="lp-mono" to={`/systems/${systemId}?section=${treasurySection.id}`} target="_blank">
              Вся Сокровищница ›
            </Link>
          )}
          {storeSection && (
            <Link className="lp-mono" to={`/systems/${systemId}?section=${storeSection.id}`} target="_blank">
              Общая лавка · награды ›
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}

type Give = (e: MouseEvent, what: string, fields: Parameters<typeof patchLitmSheet>[2]) => void;

/** Сокровище из панели сессии — сюжетной темой на лист (как в Сокровищнице). */
function SessionTreasure({ id, onGive, canGive }: { id: number; onGive: Give; canGive: boolean }) {
  const entry = useEntity<CompendiumEntry>("compendium_entry", id).data;
  if (!entry) return null;
  const t = treasuresOf([entry])[0];
  if (!t) {
    return (
      <div className="lp-rw__row">
        <span>{entry.name}</span>
      </div>
    );
  }
  const theme = treasureTheme({ name: entry.name, type: t.type, powerTags: t.powerTags, weakness: t.weakness });
  return (
    <div className="lp-rw__card">
      <b>
        {entry.name}
        <small>
          {t.type || "Сокровище"}
          {t.page && ` · ${t.page}`}
        </small>
      </b>
      <div className="lb-tags">
        {t.powerTags.map((x) => (
          <Tag key={x}>{x}</Tag>
        ))}
        {t.weakness && <Tag weak>{t.weakness}</Tag>}
      </div>
      <button type="button" className="d-btn d-btn--sm" disabled={!canGive} onClick={(e) => onGive(e, `сокровище «${entry.name}» сюжетной темой`, giveTreasure(theme))}>
        Дать герою…
      </button>
    </div>
  );
}

/** Награды книги (Общая лавка, B38): группы, «Случайная награда», вещь — тегом в рюкзак. */
function BookRewards({ groups, page, onGive, canGive }: { groups: { name: string; items: { name: string; nameEn: string }[] }[]; page: string; onGive: Give; canGive: boolean }) {
  const [group, setGroup] = useState("");
  const [hit, setHit] = useState<string | null>(null);
  const shown = group ? groups.filter((g) => g.name === group) : groups;
  const items = shown.flatMap((g) => g.items);
  const roll = () => items.length && setHit(items[Math.floor(Math.random() * items.length)].name);
  const tagGive = (e: MouseEvent, name: string) => onGive(e, `«${name}» в рюкзак`, giveBackpackTag(name));
  return (
    <section className="lp-rw__sec">
      <div className="lb-lbl">
        Награды книги<small>Общая лавка{page && ` · ${page}`}</small>
      </div>
      <div className="lp-rw__chips" role="group" aria-label="Группа наград">
        {groups.map((g) => (
          <button key={g.name} type="button" className={`d-chip${group === g.name ? " active" : ""}`} onClick={() => setGroup(group === g.name ? "" : g.name)}>
            {g.name}
          </button>
        ))}
      </div>
      <div className="lp-rw__roll">
        <button type="button" className="d-btn d-btn--sm d-btn--primary" onClick={roll}>
          Случайная награда
        </button>
        <span className="lp-mono">{group ? `из «${group}»` : "из всех групп"}</span>
      </div>
      {hit && (
        <div className="lp-rw__row is-hit" aria-live="polite">
          <span>{hit}</span>
          <span className="lp-rw__acts">
            <button type="button" className="d-btn d-btn--sm" disabled={!canGive} onClick={(e) => tagGive(e, hit)}>
              Дать герою…
            </button>
            <button type="button" className="d-btn d-btn--sm d-btn--ghost" onClick={roll}>
              Ещё раз
            </button>
          </span>
        </div>
      )}
      {group === "" && <p className="lb-empty">Выберите группу, чтобы увидеть её награды.</p>}
      {group !== "" && items.map((i) => (
        <div key={i.name} className="lp-rw__row">
          <span>
            {i.name}
            {i.nameEn && <small>{i.nameEn}</small>}
          </span>
          <button type="button" className="d-btn d-btn--sm d-btn--ghost" disabled={!canGive} onClick={(e) => tagGive(e, i.name)}>
            Дать…
          </button>
        </div>
      ))}
      <p className="lp-mono">Вещь из наград — сюжетный тег в рюкзак; следите, сколько выдаёте против истекающих на привале</p>
    </section>
  );
}

/** Плата монетой — статус «при-деньгах» выбранным героям. */
function Pay({ heroes, onPay }: { heroes: Character[]; onPay: (ids: number[], tier: number) => void }) {
  const [tier, setTier] = useState(2);
  const [who, setWho] = useState<number[]>([]);
  const flip = (id: number) => setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));
  const selected = heroes.filter((h) => who.includes(h.id)).map((h) => h.id);
  const all = heroes.length > 0 && selected.length === heroes.length;
  return (
    <section className="lp-rw__sec">
      <div className="lb-lbl">
        Плата<small>монетой — статус, товаром — сюжетный тег</small>
      </div>
      <div className="lp-rw__roll">
        <span className="lb-st">
          {PAY}
          <b>{tier}</b>
        </span>
        <span className="lp-dice" role="radiogroup" aria-label="Уровень платы">
          {TIERS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={n === tier} className={n === tier ? "is-on" : ""} onClick={() => setTier(n)}>
              {n}
            </button>
          ))}
        </span>
      </div>
      <div className="lp-rw__chips" role="group" aria-label="Кому">
        {heroes.map((h) => (
          <button key={h.id} type="button" className={`d-chip${who.includes(h.id) ? " active" : ""}`} onClick={() => flip(h.id)}>
            {h.character_name}
          </button>
        ))}
        <button type="button" className={`d-chip${all ? " active" : ""}`} disabled={!heroes.length} onClick={() => setWho(all ? [] : heroes.map((h) => h.id))}>
          Всем
        </button>
      </div>
      <button
        type="button"
        className="d-btn d-btn--sm d-btn--primary"
        disabled={!selected.length}
        onClick={() => {
          onPay(selected, tier);
          setWho([]);
        }}
      >
        Дать {PAY}-{tier}
      </button>
      <p className="lp-mono">Уровень — насколько плата велика против обычных средств героев (т. I, «Монеты», с. 137)</p>
    </section>
  );
}
