import { memo } from "react";
import type { DndAbilityScores } from "../../types";
import { ABILITY_LABELS, abilityModifier, formatModifier } from "./AbilityScores";

// Сокращённый чарник визарда создания — первый рез монолита
// DndCharacterWizard (Фаза D0). Чисто показ: вся математика и гейты
// считаются родителем и приходят готовыми пропсами, поэтому тот же
// компонент встанет справа на десктопе (D1), на обороте мобилы (D2)
// и в дельте левелапа — без второго расходящегося превью.
export interface MiniSheetProblem {
  text: string;
  target: string;
}

export interface MiniSheetSource {
  label: string;
  lines: string[];
}

export interface MiniSheetPick {
  label: string;
  text: string;
}

interface Props {
  characterName: string;
  playerName: string;
  problems: MiniSheetProblem[];
  onFix: (target: string) => void;
  abilities: DndAbilityScores;
  awardedAbilities: DndAbilityScores;
  proficiencyBonus: string;
  previewHp: number | null;
  dexMod: number;
  speed: string | null;
  alignment: string;
  languages: string[];
  dossier: MiniSheetPick[];
  sources: MiniSheetSource[];
  equipmentTaken: string[];
  equipmentItems: number;
  equipmentGold: number;
  pendingPicks: MiniSheetPick[];
  chosenSpellNames: string[];
}

export const WizardMiniSheet = memo(function WizardMiniSheet({
  characterName,
  playerName,
  problems,
  onFix,
  abilities,
  awardedAbilities,
  proficiencyBonus,
  previewHp,
  dexMod,
  speed,
  alignment,
  languages,
  dossier,
  sources,
  equipmentTaken,
  equipmentItems,
  equipmentGold,
  pendingPicks,
  chosenSpellNames,
}: Props) {
  const trimmed = characterName.trim();
  return (
    <div className="stack">
      <div>
        <strong>{trimmed || "Без имени"}</strong>
        {playerName && <span className="muted"> — {playerName}</span>}
      </div>
      {!trimmed && (
        <span className="muted">Назовите персонажа выше — без имени создать нельзя.</span>
      )}
      {problems.length === 0 ? (
        <span className="muted">Всё готово — можно создавать.</span>
      ) : (
        <div className="stack" style={{ gap: "var(--sp-2)" }}>
          <span className="muted">Перед созданием осталось:</span>
          {problems.map((p) => (
            <div key={p.text} className="row wizard-spread">
              <span>{p.text}</span>
              <button type="button" onClick={() => onFix(p.target)}>
                Исправить
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="dnd-abilities-row">
        {ABILITY_LABELS.map(({ key, label }) => (
          <div key={key} className="dnd-ability-box">
            <span className="dnd-ability-label">{label}</span>
            <span className="dnd-ability-score">{awardedAbilities[key]}</span>
            <span
              className={
                awardedAbilities[key] !== abilities[key] ? "dnd-ability-mod is-boosted" : "dnd-ability-mod"
              }
            >
              {formatModifier(abilityModifier(awardedAbilities[key]))}
            </span>
          </div>
        ))}
      </div>

      <div className="row">
        <span className="muted">
          БМ <strong className="wizard-data">{proficiencyBonus}</strong>
        </span>
        <span className="muted">
          Хиты <strong className="wizard-data">{previewHp ?? "—"}</strong>
        </span>
        <span className="muted">
          КД без доспеха <strong className="wizard-data">{10 + dexMod}</strong>
        </span>
        <span className="muted">
          Инициатива <strong className="wizard-data">{formatModifier(dexMod)}</strong>
        </span>
        <span className="muted">
          Скорость <strong className="wizard-data">{speed ? `${speed} фт.` : "—"}</strong>
        </span>
      </div>

      <div>
        <strong>Мировоззрение:</strong>{" "}
        {alignment ? <span>{alignment}</span> : <span className="muted">—</span>}
      </div>
      <div>
        <strong>Языки:</strong>{" "}
        {languages.length > 0 ? (
          <span>{languages.join(", ")}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </div>

      {dossier.map((d) => (
        <div key={d.label}>
          <strong>{d.label}:</strong> <span>{d.text}</span>
        </div>
      ))}

      {/* Разбивка по источнику, а не общий список: в плоском перечне не
          видно, что чего-то НЕ пришло, а пустая строка «Вид: ничего»
          видна сразу (решение W4). */}
      <div className="stack" style={{ gap: "var(--sp-4)" }}>
        {sources.map((src) => (
          <div key={src.label}>
            <strong>{src.label}:</strong>{" "}
            {src.lines.length > 0 ? (
              <span>{src.lines.join(" · ")}</span>
            ) : (
              <span className="muted">ничего</span>
            )}
          </div>
        ))}
      </div>

      {equipmentTaken.length === 0 ? (
        <div>
          <strong>Снаряжение:</strong> <span className="muted">не берётся</span>
        </div>
      ) : (
        <div>
          <strong>Снаряжение:</strong> {equipmentTaken.join(" · ")} ·{" "}
          {equipmentItems} предметов
          {equipmentGold > 0 && ` · ${equipmentGold} ЗМ`}
        </div>
      )}

      {pendingPicks.length > 0 && (
        <div className="stack" style={{ gap: "var(--sp-2)" }}>
          <span>
            <strong>Добрать на листе после создания:</strong>
          </span>
          {pendingPicks.map((p, i) => (
            <div key={`${p.label}-${i}`}>
              <strong>{p.label}:</strong> <span>{p.text}</span>
            </div>
          ))}
        </div>
      )}

      {chosenSpellNames.length > 0 && (
        <div>
          <strong>Выбранные заклинания:</strong>{" "}
          <span>{chosenSpellNames.join(", ")}</span>
        </div>
      )}
    </div>
  );
});
