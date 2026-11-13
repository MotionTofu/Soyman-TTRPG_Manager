import { useState } from "react";
import { COMPOUND_EFFECTS, VITALITY, type CompoundEffect, type CompoundTarget, type Injury } from "@shared/litm/compound";
import { sameStatus, statusTier } from "@shared/litm/status";
import type { LitmChallengeState } from "@shared/litm/conflict";
import { Modal } from "../../Modal";
import { useLitmSheet } from "./litmSheetWrite";

export interface CompoundInput {
  effect: CompoundEffect;
  target?: CompoundTarget;
  injury?: Injury;
  withTroop?: boolean;
  newChallenge?: string;
}

type Target = CompoundTarget & { name: string; state?: LitmChallengeState };

export function LitmCompoundEffect({ effect, source, targets, onClose, onApply }: {
  effect: CompoundEffect;
  source: Target;
  targets: Target[];
  onClose: () => void;
  onApply: (input: CompoundInput) => Promise<void>;
}) {
  const order = effect === "orderCharge";
  const healing = COMPOUND_EFFECTS[effect].profile === "Frontier Healer";
  const pickTarget = effect !== "leadCharge" && effect !== "healSelf";
  const hasInjury = effect === "healSelf" || effect === "healAlly";
  const available = targets.filter((t) => !(t.kind === "row" && t.id === source.id) && (!order || t.kind === "row"));
  const [key, setKey] = useState(source.state?.troopId && order ? `row:${source.state.troopId}` : "");
  const [withTroop, setWithTroop] = useState(true);
  const [injuryKey, setInjuryKey] = useState("");
  const [name, setName] = useState("");
  const [alive, setAlive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = available.find((t) => `${t.kind}:${t.id}` === key);
  const sheet = useLitmSheet(target?.kind === "hero" ? target.id : undefined);
  const patient = effect === "healSelf" ? source : target;
  const statuses = (patient?.kind === "hero" ? sheet?.statuses : patient?.state?.statuses) ?? [];
  const options = [
    ...statuses.filter((s) => !sameStatus(s.name, VITALITY)).map((s) => ({ kind: "status" as const, name: s.name, label: `${s.name}-${statusTier(s.marks)}` })),
    ...(patient?.state?.limits ?? []).filter((l) => l.marks.length).map((l) => ({
      kind: "limit" as const, name: l.name, label: `${l.name} · ${l.status || "уровень"} ${statusTier(l.marks)}`,
    })),
  ];
  const injury = options.find((o) => `${o.kind}:${o.name}` === injuryKey);
  const vitality = source.state?.statuses.find((s) => sameStatus(s.name, VITALITY));
  const selected = target && (target.kind !== "hero" || sheet);
  const canApply = (!pickTarget || selected) && (!hasInjury || injury) && (!healing || vitality) && (effect !== "revive" || (alive && name.trim()));

  async function submit() {
    if (busy || !canApply) return;
    setBusy(true);
    setError("");
    try {
      await onApply({ effect, target: target && { kind: target.kind, id: target.id },
        injury: injury && { kind: injury.kind, name: injury.name },
        withTroop: order ? withTroop : undefined, newChallenge: effect === "revive" ? name.trim() : undefined });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={busy ? () => {} : onClose} className="lp-effect" ariaLabel={COMPOUND_EFFECTS[effect].label}>
      <h2>{COMPOUND_EFFECTS[effect].label}</h2>
      <p>{source.name}{healing && (vitality ? ` · расход жизненной силы: 1 из ${statusTier(vitality.marks)}` : " · жизненная сила иссякла")}</p>
      {pickTarget && <label className="lp-give__name">
        {order ? "Отряд" : "Товарищ"}
        <select value={target ? key : ""} onChange={(e) => {
          setKey(e.target.value);
          setInjuryKey("");
          setAlive(false);
        }}>
          <option value="">— выбрать —</option>
          {available.map((t) => <option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>{t.name}</option>)}
        </select>
      </label>}
      {target?.kind === "hero" && !sheet && <p>У Героя нет доступного листа LitM.</p>}
      {order && <label className="lp-give__row">
        <input type="checkbox" checked={withTroop} onChange={(e) => setWithTroop(e.target.checked)} />
        Полководец сражается вместе с отрядом
      </label>}
      {effect === "leadCharge" && <p>Полководец получает <b>в-атаке-3</b> и теряет «Под охраной».</p>}
      {hasInjury && <label className="lp-give__name">
        Ранение {effect === "healSelf" ? "−1" : "−3"}
        <select value={injuryKey} onChange={(e) => setInjuryKey(e.target.value)}>
          <option value="">— выбрать —</option>
          {options.map((o) => <option key={`${o.kind}:${o.name}`} value={`${o.kind}:${o.name}`}>{o.label}</option>)}
        </select>
      </label>}
      {effect === "revive" && <>
        <label className="lp-give__row">
          <input type="checkbox" checked={alive} onChange={(e) => setAlive(e.target.checked)} />
          Товарищ выведен из боя и ещё жив
        </label>
        <label className="lp-give__name">
          Название Нового вызова
          <input maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </>}
      {effect === "ward" && <p>Товарищ получает <b>защищён-от-вреда-1</b>.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="modal-footer row">
        <button type="button" disabled={busy} onClick={onClose}>Отмена</button>
        <button type="button" className="primary" disabled={busy || !canApply} onClick={() => void submit()}>Применить</button>
      </div>
    </Modal>
  );
}
