// Лист D&D: кости хитов, «Ресурсы» и окно отдыха.
import type { DndClassEntry, DndCharacterData, DndCompanion } from "../../types";
import { type ClassResourceSource, type DndResourceDef, type ReplicaBonus, allResources, applicableStats, replicaLimits, showClassSuffix, nameMatches } from "./dndResources";
import { PROGRESSION_RECHARGE_LABELS } from "./progression";
import { poolShowsNumber, PoolMeter, PoolStepper, TofuPips } from "./TofuPips";
import { DndReplicaBlock } from "./SheetReplicas";
import { useConfirm } from "../../hooks/useConfirm";
import { isRationRow } from "./dndEquipment";
import { parseQty } from "./SheetEquipment";
import { useState } from "react";
import { restoreFreeCasts } from "./grantedSpells";
import { Modal } from "../Modal";
import { NavIcon } from "../NavIcons";

function hitDieNumber(hitDie: string): number {
  const n = parseInt(hitDie.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// "Воин 3 к10 + Волшебник 4 к6" style summary, used both to auto-fill the
// hit dice field (requirement 8) and for the header/meta line.
// Пулы костей хитов по кубам. При мультиклассе они независимы (5к10 + 3к6):
// тратятся по отдельности, и подпись куба игроку нужна перед тратой — иначе
// он не знает, что именно бросает.
interface HitDicePool {
  die: string; // «к10»
  total: number;
  used: number;
}

// Разбирается сохранённая строка костей («5к10 + 3к6»), а не кэш иерархии
// классов: кэш наполняется только когда открыта панель правки происхождения,
// а дорожки нужны на листе, который просто читают.
export function hitDicePools(hitDice: string, used: Record<string, number>): HitDicePool[] {
  const byDie = new Map<string, number>();
  for (const part of (hitDice || "").split("+")) {
    const m = /^\s*(\d+)\s*[ккдkd]\s*(\d+)\s*$/i.exec(part);
    if (!m) continue;
    const count = Number(m[1]);
    if (!count) continue;
    const die = "к" + m[2];
    byDie.set(die, (byDie.get(die) ?? 0) + count);
  }
  return [...byDie.entries()].map(([die, total]) => ({
    die,
    total,
    used: Math.min(Math.max(used[die] ?? 0, 0), total),
  }));
}

// Длинный отдых возвращает половину общего числа костей, минимум одну
// (PHB 2024). Считается от всего запаса, а не по каждому пулу отдельно, и
// возвращается сначала тем пулам, где потрачено больше.
function restoreHitDiceOnLongRest(pools: HitDicePool[]): Record<string, number> {
  const total = pools.reduce((n, p) => n + p.total, 0);
  let back = Math.max(1, Math.floor(total / 2));
  const next: Record<string, number> = {};
  for (const p of pools) next[p.die] = p.used;
  const order = [...pools].sort((a, b) => b.used - a.used);
  let moved = true;
  while (back > 0 && moved) {
    moved = false;
    for (const p of order) {
      if (back <= 0) break;
      if (next[p.die] > 0) {
        next[p.die] -= 1;
        back -= 1;
        moved = true;
      }
    }
  }
  return next;
}

export function computeHitDice(classes: DndClassEntry[]): string {
  return classes
    .filter((c) => c.level > 0)
    .map((c) => {
      const hierarchyDie = classHitDieCache.get(c.classId ?? -1);
      const die = hierarchyDie ? hitDieNumber(hierarchyDie) : 0;
      return die ? `${c.level}к${die}` : "";
    })
    .filter(Boolean)
    .join(" + ");
}

// Populated as class hierarchies load, so computeHitDice (called from onChange
// handlers without async access) can look up a class's hit die synchronously.
export const classHitDieCache = new Map<number, string>();

export function DndResourcesView({
  sources,
  abilities,
  resourceUsed,
  resourceBonus,
  value,
  systemId,
  campaignId,
  ownerCharacterId,
  ownPools,
  replicaBonus,
  onQuickUpdate,
}: {
  sources: ClassResourceSource[];
  abilities: DndCharacterData["abilities"];
  resourceUsed: Record<string, number>;
  resourceBonus: Record<string, number>;
  value: DndCharacterData;
  systemId: number | null;
  campaignId?: number | null;
  ownerCharacterId?: number | null;
  /** Свои пулы умений — теми же строками, что классовые. */
  ownPools: DndResourceDef[];
  /** Бонус к пределам реплик (Лучший бронник) — показом в блоке реплик. */
  replicaBonus?: ReplicaBonus | null;
  onQuickUpdate?: (patch: Partial<DndCharacterData>) => void;
}) {
  const resources = [...allResources(sources, abilities), ...ownPools];
  const stats = applicableStats(sources);
  const replicas = replicaLimits(sources);
  if (resources.length === 0 && stats.length === 0 && replicas.length === 0)
    return <p className="muted">Нет доступных ресурсов для текущих классов.</p>;
  // Класс подписываем только у многоклассовых персонажей: у одноклассового
  // это шум, а «Проведение божественности» бывает и у Жреца, и у Паладина
  // сразу, и различить их иначе нечем. У своих пулов класса нет — суффикса нет.
  // Подкласс корнем не считается (showClassSuffix): иначе одноклассовый
  // Воин/Мастер боевых искусств выглядел бы многоклассовым.
  const showClass = showClassSuffix(sources);
  return (
    <div className="stack dnd-pools">
      {resources.map((r) => {
        const bonus = resourceBonus[r.key] ?? 0;
        const max = r.max + bonus;
        const used = Math.min(resourceUsed[r.key] ?? 0, max);
        return (
          // Макет Sheet-PC-Resources: название и правило восстановления
          // слева, «− N/M +» посередине строки, бонус справа, тофу ниже.
          <div key={r.key} className="sb-entry dnd-pool-row">
            <span className="dnd-pool-title">
              <span className="sb-prop-label">
                {r.label}
                {showClass && r.className && <span className="muted"> · {r.className}</span>}
              </span>
              <span className="dnd-pool-recharge">
                {r.recharge === "none"
                  ? PROGRESSION_RECHARGE_LABELS.none.toLowerCase()
                  : `восстановление: ${PROGRESSION_RECHARGE_LABELS[r.recharge].toLowerCase()}`}
                {r.restore ? ` · или за ${r.restore.amount} ${r.restore.pool}` : ""}
              </span>
            </span>
            <span className="dnd-pool-center">
              {poolShowsNumber(max) ? (
                <PoolMeter
                  max={max}
                  left={max - used}
                  label={r.label}
                  onSetLeft={
                    onQuickUpdate ? (next) => onQuickUpdate({ resourceUsed: { ...resourceUsed, [r.key]: max - next } }) : undefined
                  }
                />
              ) : (
                <PoolStepper
                  max={max}
                  left={max - used}
                  label={r.label}
                  onSetLeft={
                    onQuickUpdate ? (next) => onQuickUpdate({ resourceUsed: { ...resourceUsed, [r.key]: max - next } }) : undefined
                  }
                />
              )}
            </span>
            <label className="row muted dnd-pool-bonus" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
              доп. бонус
              <input
                type="number"
                style={{ width: 44 }}
                disabled={!onQuickUpdate}
                value={bonus || ""}
                onChange={(e) =>
                  onQuickUpdate?.({ resourceBonus: { ...resourceBonus, [r.key]: Number(e.target.value) || 0 } })
                }
              />
            </label>
            {/* Ряд голов под строкой — только ПК: на телефоне счётчик
                посередине уже «− N/M +», второй был бы повтором (CSS). */}
            {!poolShowsNumber(max) && (
              <TofuPips
                max={max}
                left={max - used}
                label={r.label}
                onSetLeft={
                  onQuickUpdate ? (next) => onQuickUpdate({ resourceUsed: { ...resourceUsed, [r.key]: max - next } }) : undefined
                }
              />
            )}
            {/* Восстановление чужой ценой («Крылья»: пополнить за 3 очка
                чародейства): одним сохранением обнуляет свой и списывает
                с донора. Видна, только когда есть что чинить и чем платить. */}
            {(() => {
              if (!r.restore || !onQuickUpdate || used <= 0) return null;
              const donor = resources.find(
                (d) => d.key !== r.key && d.label.toLowerCase() === r.restore!.pool.toLowerCase()
              );
              if (!donor) return null;
              const donorMax = donor.max + (resourceBonus[donor.key] ?? 0);
              const donorUsed = Math.min(resourceUsed[donor.key] ?? 0, donorMax);
              const price = r.restore.amount;
              if (donorMax - donorUsed < price) return null;
              return (
                <button
                  type="button"
                  className="comp-mini"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() =>
                    onQuickUpdate({
                      resourceUsed: { ...resourceUsed, [r.key]: 0, [donor.key]: donorUsed + price },
                    })
                  }
                >
                  Восстановить ({price} {donor.label})
                </button>
              );
            })()}
          </div>
        );
      })}
      {replicas.map((limits) => (
        <DndReplicaBlock
          key={`${limits.classId}`}
          limits={limits}
          value={value}
          systemId={systemId}
          campaignId={campaignId}
          ownerCharacterId={ownerCharacterId}
          replicaBonus={replicaBonus}
          onQuickUpdate={onQuickUpdate}
        />
      ))}
      {stats.length > 0 && (
        <div className="sb-entry dnd-level-stats">
          {/* Показатели по уровню — тратить нечего, поэтому без дорожек. */}
          {stats.map((st) => (
            <div key={st.key} className="row" style={{ justifyContent: "space-between" }}>
              <span className="sb-prop-label">
                {st.label}
                {showClass && <span className="muted"> · {st.className}</span>}
              </span>
              <span>{st.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Rest flow: short rest is purely informational (a reminder of the hit-dice
// pool — actually spending them to heal isn't tracked as a resource
// anywhere on this sheet, matching how the app leaves that up to the table).
// Long rest is the one with a mechanical effect: bulk-resets everything the
// rest of the sheet marks as "spent this rest" — spell slots used and every
// class-resource pool (Ресурсы tab) — plus the standard 5e full heal and
// clearing accumulated death saves, so the button does what a player
// actually expects "long rest" to do rather than just the two fields whose
// own comments mention resetting on one.
export function DndRestModal({
  value,
  resources,
  pools,
  companionsAfterRest,
  shortGrants,
  tireless,
  kind,
  onQuickUpdate,
  onClose,
}: {
  value: DndCharacterData;
  resources: DndResourceDef[];
  pools: HitDicePool[];
  /** Какой отдых открыт: на обороте карты две кнопки — «Короткий» и
   *  «Долгий» (макет 2026-09-25), каждая ведёт в свой раздел. */
  kind: "short" | "long";
  /** Тела спутников после долгого отдыха (пушки развеяны, защитник пересобран)
   *  — null, когда менять нечего. Считает родитель: модалке компендиум не виден. */
  companionsAfterRest?: DndCompanion[] | null;
  /** Гранты короткого отдыха чужим пулам («Проблеск +1») — считает родитель
   *  из живых особенностей; модалка только применяет. */
  shortGrants?: { key: string; label: string; amount: number | "full" }[];
  /** Неутомимый следопыта (10 ур.): короткий отдых снижает истощение на 1.
   *  Считает родитель из живых особенностей; модалка только применяет. */
  tireless?: boolean;
  onQuickUpdate: (patch: Partial<DndCharacterData>) => void;
  onClose: () => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  const shortNames = resources.filter((r) => r.recharge === "short").map((r) => r.label);
  const longNames = resources.filter((r) => r.recharge === "long").map((r) => r.label);
  const neverNames = resources.filter((r) => r.recharge === "none").map((r) => r.label);
  // Предметы с зарядами «на рассвете» и числовым максимумом — длинный отдых
  // вернёт их до максимума (см. longRest ниже).
  const restoredPreviewCharges = value.equipmentSections.some((sec) =>
    sec.items.some(
      (it) =>
        it.chargesRecharge === "dawn" &&
        !!it.chargesMax &&
        /^\d+$/.test(it.chargesMax.trim()) &&
        it.chargesLeft !== Number(it.chargesMax.trim())
    )
  );
  const spentDice = pools.reduce((n, p) => n + p.used, 0);
  const totalDice = pools.reduce((n, p) => n + p.total, 0);
  // Рационы: долгий отдых предлагает съесть один. Считаем только своё
  // (не отданное), строка без счёта — это 1 шт.
  const rationRows = value.equipmentSections.flatMap((s, si) =>
    s.items.map((it, ii) => ({ it, si, ii })).filter(({ it }) => !it.transferOut && isRationRow(it))
  );
  const rationTotal = rationRows.reduce((n, { it }) => n + parseQty(String(it.qty ?? "")), 0);
  const [eatRation, setEatRation] = useState(true);

  function resetResources(which: "short" | "long"): Record<string, number> {
    const next = { ...value.resourceUsed };
    for (const r of resources) {
      // Короткий отдых чинит только своё; длинный — и своё, и короткое.
      // «Не восстанавливается отдыхом» не трогает ни один: раньше длинный
      // обнулял вообще все пулы подряд, включая заряды предметов.
      if (r.recharge === "none") continue;
      if (which === "long" || r.recharge === "short") next[r.key] = 0;
    }
    return next;
  }

  // Подписи грантов короткого отдыха: «Проблеск гениальности (+1)».
  // Только неполные пулы — полный обещать «восстановить» враньё.
  const grantLabels = (shortGrants ?? [])
    .filter((g) => (value.resourceUsed[g.key] ?? 0) > 0)
    .map((g) => `${g.label} (${g.amount === "full" ? "полностью" : `+${g.amount}`})`);
  async function shortRest() {
    // Неутомимый следопыта: каждый короткий отдых −1 истощение.
    const tirelessDrain = tireless && value.exhaustion > 0 ? 1 : 0;
    const ok = await confirm({
      title: "Короткий отдых?",
      message: [
        shortNames.length > 0
          ? `Восстановятся ячейки договора магии и ресурсы: ${shortNames.join(", ")}.`
          : "Восстановятся ячейки договора магии. Ресурсов короткого отдыха у этого персонажа нет.",
        ...(grantLabels.length > 0 ? [`Частично восстановятся: ${grantLabels.join(", ")}.`] : []),
        ...(tirelessDrain > 0 ? [`Истощение: ${value.exhaustion} → ${value.exhaustion - 1} (Неутомимый).`] : []),
        "Кости хитов тратятся вручную дорожкой в виталах: сколько потратили, столько и вылечили.",
      ].join("\n\n"),
      confirmLabel: "Отдохнуть",
    });
    if (!ok) return;
    const used = resetResources("short");
    for (const g of shortGrants ?? []) {
      const cur = used[g.key] ?? value.resourceUsed[g.key] ?? 0;
      used[g.key] = g.amount === "full" ? 0 : Math.max(0, cur - g.amount);
    }
    onQuickUpdate({
      pactSlotsUsed: 0,
      resourceUsed: used,
      ...(tirelessDrain > 0 ? { exhaustion: Math.max(0, value.exhaustion - 1) } : {}),
    });
    onClose();
  }

  async function longRest() {
    const back = pools.length > 0 ? Math.max(1, Math.floor(totalDice / 2)) : 0;
    // Заряды предметов «на рассвете» — до числового максимума из снапшота.
    // Кубический максимум и «не восстанавливаются» не трогаем.
    const restoredSections = value.equipmentSections.map((sec) => ({
      ...sec,
      items: sec.items.map((it) => {
        if (it.chargesRecharge !== "dawn" || !it.chargesMax || !/^\d+$/.test(it.chargesMax.trim())) return it;
        const max = Number(it.chargesMax.trim());
        return it.chargesLeft === max ? it : { ...it, chargesLeft: max };
      }),
    }));
    const restoredCharges = restoredSections
      .flatMap((s) => s.items)
      .filter((it) => it.chargesMax)
      .map((it) => it.name)
      .filter((n) => n);
    // Рацион списываем с первой непустой строки.
    const rationAt = eatRation ? rationRows.find(({ it }) => parseQty(String(it.qty ?? "")) > 0) : undefined;
    const ok = await confirm({
      title: "Длинный отдых?",
      message: [
        "Хиты до максимума, спасброски от смерти сброшены, концентрация снята, все ячейки заклинаний восстановлены.",
        back > 0 ? `

Костей хитов вернётся: ${Math.min(back, spentDice)} из ${spentDice} потраченных.` : "",
        value.exhaustion > 0 ? `

Истощение: ${value.exhaustion} → ${value.exhaustion - 1}.` : "",
        neverNames.length > 0 ? `

Не восстановится: ${neverNames.join(", ")}.` : "",
        companionsAfterRest ? `

Тела спутников: временные исчезают (час пушки истёк), защитник собирается заново.` : "",
        (value.elixirs ?? []).length > 0 ? `

Эликсиры: старые сгорают вместе с флаконами — создайте новые.` : "",
        restoredCharges.length > 0 ? `

Заряды предметов восстановлены до максимума: ${restoredCharges.join(", ")}.` : "",
        rationAt ? `

Съеден рацион (−1).` : "",
        swapNotes.length > 0 ? `

Можно сменить: ${swapNotes.join("; ")}.` : "",
      ].join(""),
      confirmLabel: "Отдохнуть",
    });
    if (!ok) return;
    const finalSections = rationAt
      ? restoredSections.map((s, si) =>
          si !== rationAt.si
            ? s
            : {
                ...s,
                items: s.items.map((it, ii) =>
                  ii !== rationAt.ii ? it : { ...it, qty: String(Math.max(0, parseQty(String(it.qty ?? "")) - 1)) }
                ),
              }
        )
      : restoredSections;
    onQuickUpdate({
      spellSlotsUsed: value.spellSlotsUsed.map(() => 0),
      pactSlotsUsed: 0,
      resourceUsed: resetResources("long"),
      ...(companionsAfterRest ? { companions: companionsAfterRest } : {}),
      // Эликсиры сгорают вместе с флаконами — чистим, новые создаёт игрок.
      ...((value.elixirs ?? []).length > 0 ? { elixirs: [] } : {}),
      equipmentSections: finalSections,
      hitDiceUsed: restoreHitDiceOnLongRest(pools),
      hitPointsCurrent: value.hitPointMax,
      hitPointsTemp: "0",
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      concentration: "",
      // Действующие заклинания (8 часов «Доспехов мага», «Щит») отдых не
      // переживают — иначе КЗ назавтра считал бы вчерашнее (Q16).
      activeSpells: [],
      receivedSpells: [],
      // 5.5: длинный отдых снимает один уровень истощения, а не всё сразу.
      exhaustion: Math.max(0, value.exhaustion - 1),
      // Бесплатные сотворения черт («Посвящённый», «Затронутые», метки).
      ...restoreFreeCasts(value),
    });
    onClose();
  }

  // Напоминания о сменах на долгом отдыхе (тикет 08): книга разрешает
  // сменить 1 освоенное оружие (Воин), оба оружейных приёма (Следопыт) и
  // язык полиглота (Баннерет). Показываем только тем, кого касается; сами
  // правки — руками.
  const hasMasteredWeapons = value.masteredWeapons.length > 0;
  const hasRangerMastery = value.classes.some((c) => nameMatches(c.className, "Следопыт"));
  const hasBanneret = value.classes.some(
    (c) => c.subclassName && nameMatches(c.subclassName, "Баннерет")
  );
  const swapNotes: string[] = [
    // Следопыт меняет оба приёма целиком, а не 1 оружие, как Воин.
    ...(hasRangerMastery
      ? ["можно сменить оружейные приёмы (правка — в особенностях)"]
      : hasMasteredWeapons
        ? ["можно сменить 1 освоенное оружие (правка — в особенностях)"]
        : []),
    ...(hasBanneret ? ["можно сменить язык полиглота (владения)"] : []),
  ];
  return (
    <Modal onClose={onClose}>
      <div className="stack dnd-spell-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{kind === "short" ? "Короткий отдых" : "Длинный отдых"}</h3>
          <button type="button" className="comp-mini" onClick={onClose} aria-label="Закрыть">
            <NavIcon name="close" />
          </button>
        </div>

        {kind === "short" && (
        <div className="stack" style={{ gap: 4 }}>
          <p className="muted" style={{ margin: 0 }}>
            {shortNames.length > 0
              ? `Восстановит: ячейки договора магии, ${shortNames.join(", ")}.`
              : "Восстановит ячейки договора магии. Ресурсов короткого отдыха у этого персонажа нет."}
            {grantLabels.length > 0 && ` Частично: ${grantLabels.join(", ")}.`}
          </p>
          {pools.length > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Кости хитов тратятся дорожкой в виталах — потрачено {spentDice} из {totalDice}.
            </p>
          )}
          <button type="button" onClick={shortRest} style={{ alignSelf: "flex-start" }}>
            Провести короткий отдых
          </button>
        </div>
        )}

        {kind === "long" && (
        <div className="stack" style={{ gap: 4 }}>
          <p className="muted" style={{ margin: 0 }}>
            Восстановит хиты, снимет спасброски от смерти и концентрацию, вернёт все ячейки
            {longNames.length + shortNames.length > 0 ? " и ресурсы классов" : ""}
            {restoredPreviewCharges ? ", заряды предметов" : ""}
            {pools.length > 0 ? `, вернёт половину костей хитов (${Math.max(1, Math.floor(totalDice / 2))})` : ""}.
            {companionsAfterRest && " Временные тела исчезнут, защитник соберётся заново."}
            {(value.elixirs ?? []).length > 0 && " Эликсиры сгорят."}
            {neverNames.length > 0 && ` Не восстановится: ${neverNames.join(", ")}.`}
            {swapNotes.length > 0 && ` Можно сменить: ${swapNotes.join("; ")}.`}
          </p>
          {rationTotal > 0 && (
            <label className="row" style={{ gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={eatRation} onChange={(e) => setEatRation(e.target.checked)} />
              Съесть рацион (−1, осталось: {rationTotal})
            </label>
          )}
          <button type="button" className="primary" onClick={longRest} style={{ alignSelf: "flex-start" }}>
            Провести длинный отдых
          </button>
        </div>
        )}
        {confirmDialog}
      </div>
    </Modal>
  );
}
