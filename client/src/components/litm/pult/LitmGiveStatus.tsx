import { useState } from "react";
import { sameStatus, spendStatusDefense, STATUS_MAX_TIER, statusTier, type LitmStatus } from "@shared/litm/status";
import { consequenceAdjustment, consequenceTier, type MightStep } from "@shared/litm/consequence";
import type { LitmLimitSide } from "@shared/litm/conflict";
import { Modal } from "../../Modal";
import { limitFor } from "./consequence";
import { HeroMight, SourceMight, type ConsequenceSource } from "./LitmConsequenceMight";
import { useLitmSheet } from "./litmSheetWrite";

/** Кому можно дать статус: герой (лист), вызов на ленте или сцена. */
export interface GiveTarget {
  key: string;
  label: string;
  kind: "hero" | "challenge" | "scene";
  heroId?: number;
  limits?: { name: string; status: string; max: number | null; sides?: LitmLimitSide[]; defense?: string }[];
  statuses?: LitmStatus[];
}

export interface GiveRequest {
  keys: string[];
  name: string;
  tier: number;
  mode: "give" | "reduce";
  /** Вызов: номер предела, против которого засчитать; null — вне пределов. */
  limit: number | null;
  /** Уже имеющийся статус, с которым Рассказчик накапливает новый. */
  into?: string;
  opposite?: string;
  /** Итог после сравнения Могущества, отдельно для каждого Героя. */
  heroTiers?: Record<string, number>;
  /** Статус, снимаемый перед зачётом оставшихся уровней. */
  defense?: string | null;
}

export interface GiveInitial {
  keys: string[];
  name?: string;
  tier?: number;
  mode?: "give" | "reduce";
  limit?: number;
  source?: ConsequenceSource;
  announced?: { rowId: number; threat: number };
  tags?: "give" | "scratch";
}

const TIERS = Array.from({ length: STATUS_MAX_TIER }, (_, i) => i + 1);

/**
 * «Дать статус» (Q13): цели фишками (можно несколько), имя, уровень 1–6,
 * дать или ослабить. Одной цели — «засчитать против предела» (вызов) или
 * «Сложить с» её статусом (герой, сцена).
 */
export function LitmGiveStatus({
  targets,
  initial,
  onClose,
  onApply,
  onTags,
}: {
  targets: GiveTarget[];
  initial: GiveInitial;
  onClose: () => void;
  onApply: (req: GiveRequest) => Promise<string[]>;
  onTags?: (draft: Pick<GiveInitial, "keys" | "name" | "tier" | "mode">) => void;
}) {
  const [keys, setKeys] = useState<string[]>(initial.keys.filter((k) => targets.some((t) => t.key === k)));
  const [name, setName] = useState(initial.name ?? "");
  const [tier, setTier] = useState(initial.tier ?? 1);
  const [mode, setMode] = useState<"give" | "reduce">(initial.mode ?? "give");
  const [limitPick, setLimitPick] = useState<string | null>(initial.limit == null ? null : String(initial.limit));
  const [into, setInto] = useState("");
  const [opposite, setOpposite] = useState("");
  const [defense, setDefense] = useState<string | null>(null);
  const [sourceMight, setSourceMight] = useState<MightStep | "">("");
  const [heroMights, setHeroMights] = useState<Record<string, MightStep | "">>({});
  const [livingLegends, setLivingLegends] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const single = keys.length === 1 ? (targets.find((t) => t.key === keys[0]) ?? null) : null;
  const heroSheet = useLitmSheet(single?.heroId);
  const ownStatuses = (single?.kind === "hero" ? heroSheet?.statuses : single?.statuses) ?? [];

  const limits = single?.kind === "challenge" ? (single.limits ?? []) : [];
  // Предел по умолчанию — по смыслу имени; выбор Мастера держится, пока он его не сменит.
  const guess = limits.length ? limitFor(limits, name) : null;
  const limit = limitPick === null ? guess : limitPick === "" ? null : Number(limitPick);
  const selectedLimit = limit == null ? undefined : limits[limit];
  const canApply = selectedLimit?.max !== null && (!selectedLimit?.sides?.length || (mode === "give"
    ? limitFor([selectedLimit], name) === 0
    : sameStatus(selectedLimit.status, name)));
  const selectedHeroes = targets.filter((t): t is GiveTarget & { heroId: number } => t.heroId != null && keys.includes(t.key));
  const compare = !!initial.source && selectedHeroes.length > 0;
  const adjustment = (key: string) => consequenceAdjustment(sourceMight, heroMights[key] ?? "", livingLegends[key]).tiers;
  const heroTiers = Object.fromEntries(selectedHeroes.map(({ key }) => [key, consequenceTier(tier, adjustment(key), STATUS_MAX_TIER)]));
  const defenseOptions = mode === "give" && single?.kind !== "scene"
    ? ownStatuses.filter((s) => !sameStatus(s.name, name) && !sameStatus(s.name, into) && !sameStatus(s.name, opposite))
    : [];
  const chosenDefense = defense ?? selectedLimit?.defense ?? "";
  const activeDefense = defenseOptions.find((s) => sameStatus(s.name, chosenDefense))?.name;
  const defenseChange = mode !== "give" ? undefined : defense === "" ? null : activeDefense;
  const defenseTier = single ? heroTiers[single.key] ?? tier : tier;
  const absorption = activeDefense ? spendStatusDefense(ownStatuses, defenseTier, activeDefense) : null;
  const noEffect = compare && keys.every((key) => heroTiers[key] === 0);

  function toggle(key: string) {
    setKeys((k) => (k.includes(key) ? k.filter((x) => x !== key) : [...k, key]));
    setLimitPick(null);
    setInto("");
    setOpposite("");
    setDefense(null);
  }

  async function submit() {
    const clean = name.trim().replace(/\*/g, "");
    if (busy || !clean || !keys.length || !canApply) return;
    setBusy(true);
    try {
      const failed = await onApply({ keys, name: clean, tier, mode, limit: single?.kind === "challenge" ? limit : null,
        into: mode === "give" && single && !selectedLimit && !opposite && into ? into : undefined,
        opposite: mode === "give" && single && !selectedLimit && opposite ? opposite : undefined,
        heroTiers: compare ? heroTiers : undefined,
        defense: defenseChange,
      });
      if (failed.length) setKeys(failed);
      else onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={busy ? () => {} : onClose} ariaLabel="Дать статус" className="lp-give lp-effect" wide>
      <h2>{mode === "give" ? "Дать статус" : "Ослабить статус"}</h2>
      <div className="lp-give__row lp-give__targets" role="group" aria-label="Кому">
        {targets.map((t) => (
          <button key={t.key} type="button" className={`lp-chip${keys.includes(t.key) ? " is-on" : ""}`} aria-pressed={keys.includes(t.key)} onClick={() => toggle(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="lp-give__row">
        <label className="lp-give__name">
          Статус
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="напуган" onKeyDown={(e) => e.key === "Enter" && void submit()} />
        </label>
        <span className="lp-give__tiers" role="group" aria-label={mode === "give" ? "Уровень" : "На сколько"}>
          {TIERS.map((k) => (
            <button key={k} type="button" className={k === tier ? "is-on" : ""} aria-pressed={k === tier} onClick={() => setTier(k)}>
              {k}
            </button>
          ))}
        </span>
      </div>
      <div className="lp-give__row" role="group" aria-label="Что сделать">
        <button type="button" className={`lp-chip${mode === "give" ? " is-on" : ""}`} aria-pressed={mode === "give"} onClick={() => setMode("give")}>
          Дать
        </button>
        <button type="button" className={`lp-chip${mode === "reduce" ? " is-on" : ""}`} aria-pressed={mode === "reduce"} onClick={() => setMode("reduce")}>
          Ослабить
        </button>
      </div>
      {single?.kind === "challenge" && limits.length > 0 && (
        <label className="lp-give__row">
          {mode === "give" ? "Засчитать против предела" : "С предела"}
          <select value={limit == null ? "" : String(limit)} onChange={(e) => {
            setLimitPick(e.target.value);
            setDefense(null);
          }}>
            <option value="">— вне пределов —</option>
            {limits.map((l, i) => (
              <option key={`${l.name}-${i}`} value={i} disabled={l.max == null}>
                {l.name} {l.max ?? "—"}{l.sides?.length ? ` · ${l.sides.map((s) => s.status).join(" / ")}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {single && !selectedLimit && mode === "give" && ownStatuses.length > 0 && (
        <label className="lp-give__row">
          Связь с имеющимся статусом
          <select value={opposite ? `opposite:${opposite}` : into ? `into:${into}` : ""} onChange={(e) => {
            const value = e.target.value;
            setInto(value.startsWith("into:") ? value.slice(5) : "");
            setOpposite(value.startsWith("opposite:") ? value.slice(9) : "");
          }}>
            <option value="">— накопление по имени —</option>
            {ownStatuses.map((s) => (
              <option key={`into:${s.name}`} value={`into:${s.name}`}>Накопить вместе с {s.name}-{statusTier(s.marks)}</option>
            ))}
            {ownStatuses.map((s) => (
              <option key={`opposite:${s.name}`} value={`opposite:${s.name}`}>Погасить противоположный {s.name}-{statusTier(s.marks)}</option>
            ))}
          </select>
        </label>
      )}
      {compare && initial.source && (
        <fieldset className="lp-give__might">
          <legend>Могущество в подходящем аспекте</legend>
          <SourceMight source={initial.source} value={sourceMight} onChange={setSourceMight} />
          {selectedHeroes.map((hero) => {
            const delta = adjustment(hero.key);
            const mayUseLegend = consequenceAdjustment(sourceMight, heroMights[hero.key] ?? "").tiers === 3;
            return (
              <div key={hero.key}>
                <HeroMight heroId={hero.heroId} label={hero.label} value={heroMights[hero.key] ?? ""} onChange={(step) => setHeroMights((values) => ({ ...values, [hero.key]: step }))} />
                {mayUseLegend && <label className="lp-give__row">
                  <input type="checkbox" checked={!!livingLegends[hero.key]} onChange={(e) => setLivingLegends((values) => ({ ...values, [hero.key]: e.target.checked }))} />
                  Живая легенда · {hero.label}
                </label>}
                <small className="lp-give__preview" aria-live="polite">{delta ? `Поправка ${delta > 0 ? "+" : "−"}${Math.abs(delta)} · ` : ""}Итог: {heroTiers[hero.key]} ур.</small>
              </div>
            );
          })}
        </fieldset>
      )}
      {mode === "give" && (defenseOptions.length > 0 || selectedLimit?.defense) && (
        <label className="lp-give__row">
          Снимаемая защита
          <select value={activeDefense ?? chosenDefense} onChange={(e) => setDefense(e.target.value)}>
            <option value="">— без снимаемой защиты —</option>
            {!activeDefense && chosenDefense && <option value={chosenDefense}>{chosenDefense} · снята</option>}
            {defenseOptions.map((s) => <option key={s.name} value={s.name}>{s.name}-{statusTier(s.marks)}</option>)}
          </select>
        </label>
      )}
      {absorption && <p className="lp-give__preview" role="status">
        На снятие защиты: {absorption.spent} ур. · {selectedLimit ? "В Предел" : "В статус"}: {absorption.remaining} ур.
      </p>}
      <div className="modal-footer row">
        {onTags && <button type="button" disabled={busy} onClick={() => onTags({ keys, name, tier, mode })}>Последствие тегами…</button>}
        <button type="button" disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="primary" disabled={busy || !name.trim() || !keys.length || !canApply} onClick={() => void submit()}>
          {noEffect ? "Завершить без эффекта"
            : activeDefense || (compare && selectedHeroes.some(({ key }) => heroTiers[key] !== tier)) ? "Применить"
              : mode === "give" ? `Дать ${name.trim() || "статус"}-${tier}` : `Ослабить на ${tier}`}
        </button>
      </div>
    </Modal>
  );
}
