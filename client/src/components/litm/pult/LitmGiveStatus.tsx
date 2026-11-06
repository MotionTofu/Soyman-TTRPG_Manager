import { useMemo, useState } from "react";
import { STATUS_MAX_TIER, statusTier, type LitmStatus } from "@shared/litm/status";
import { useResource } from "../../../data/hooks";
import { statblockListPath } from "../../../data/statblocks";
import type { Statblock } from "../../../types";
import { Modal } from "../../Modal";
import { normalizeCharacter } from "../LitMCharacterForm";
import { limitFor } from "./consequence";

/** Кому можно дать статус: герой (лист), вызов на ленте или сцена. */
export interface GiveTarget {
  key: string;
  label: string;
  kind: "hero" | "challenge" | "scene";
  heroId?: number;
  limits?: { name: string; status: string; max: number | null }[];
  statuses?: LitmStatus[];
}

export interface GiveRequest {
  keys: string[];
  name: string;
  tier: number;
  mode: "give" | "reduce";
  /** Вызов: номер предела, против которого засчитать; null — вне пределов. */
  limit: number | null;
  /** «Сложить с» — статус цели, которым Рассказчик признал новый. */
  into?: string;
}

export interface GiveInitial {
  keys: string[];
  name?: string;
  tier?: number;
  mode?: "give" | "reduce";
}

const TIERS = Array.from({ length: STATUS_MAX_TIER }, (_, i) => i + 1);
const NO_STATBLOCKS: Statblock[] = [];

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
}: {
  targets: GiveTarget[];
  initial: GiveInitial;
  onClose: () => void;
  onApply: (req: GiveRequest) => Promise<void>;
}) {
  const [keys, setKeys] = useState<string[]>(initial.keys.filter((k) => targets.some((t) => t.key === k)));
  const [name, setName] = useState(initial.name ?? "");
  const [tier, setTier] = useState(initial.tier ?? 1);
  const [mode, setMode] = useState<"give" | "reduce">(initial.mode ?? "give");
  const [limitPick, setLimitPick] = useState<string | null>(null);
  const [into, setInto] = useState("");
  const [busy, setBusy] = useState(false);

  const single = keys.length === 1 ? (targets.find((t) => t.key === keys[0]) ?? null) : null;
  const heroRows = useResource<Statblock[]>(single?.kind === "hero" && single.heroId ? statblockListPath("character", single.heroId) : null).data ?? NO_STATBLOCKS;
  const ownStatuses = useMemo<LitmStatus[]>(() => {
    if (!single) return [];
    if (single.kind !== "hero") return single.statuses ?? [];
    const sb = heroRows.find((s) => s.format === "litm_character");
    try {
      return sb ? (normalizeCharacter(JSON.parse(sb.content || "{}")).statuses ?? []) : [];
    } catch {
      return [];
    }
  }, [single, heroRows]);

  const limits = single?.kind === "challenge" ? (single.limits ?? []) : [];
  // Предел по умолчанию — по смыслу имени; выбор Мастера держится, пока он его не сменит.
  const guess = limits.length ? limitFor(limits, name) : null;
  const limit = limitPick === null ? guess : limitPick === "" ? null : Number(limitPick);

  function toggle(key: string) {
    setKeys((k) => (k.includes(key) ? k.filter((x) => x !== key) : [...k, key]));
  }

  async function submit() {
    const clean = name.trim().replace(/\*/g, "");
    if (!clean || !keys.length) return;
    setBusy(true);
    try {
      await onApply({ keys, name: clean, tier, mode, limit: single?.kind === "challenge" ? limit : null, into: single && single.kind !== "challenge" && into ? into : undefined });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} ariaLabel="Дать статус" className="lp-give">
      <h2>{mode === "give" ? "Дать статус" : "Ослабить статус"}</h2>
      <div className="lp-give__row" role="group" aria-label="Кому">
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
          <select value={limit == null ? "" : String(limit)} onChange={(e) => setLimitPick(e.target.value)}>
            <option value="">— вне пределов —</option>
            {limits.map((l, i) => (
              <option key={`${l.name}-${i}`} value={i} disabled={l.max == null}>
                {l.name} {l.max ?? "—"}
              </option>
            ))}
          </select>
        </label>
      )}
      {single && single.kind !== "challenge" && mode === "give" && ownStatuses.length > 0 && (
        <label className="lp-give__row">
          Сложить с
          <select value={into} onChange={(e) => setInto(e.target.value)}>
            <option value="">— по имени —</option>
            {ownStatuses.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}-{statusTier(s.marks)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="modal-footer row">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="primary" disabled={busy || !name.trim() || !keys.length} onClick={() => void submit()}>
          {mode === "give" ? `Дать ${name.trim() || "статус"}-${tier}` : `Ослабить на ${tier}`}
        </button>
      </div>
    </Modal>
  );
}
