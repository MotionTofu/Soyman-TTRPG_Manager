import type { MightStep } from "@shared/litm/consequence";
import { MIGHT_STEPS } from "@shared/litm/consequence";
import { MIGHT_NAMES } from "../litmBookText";
import type { LitMCharacterData } from "../../../types";
import { useLitmSheet } from "./litmSheetWrite";

export interface MightAspect {
  name: string;
  level: MightStep;
}

export interface ConsequenceSource {
  name: string;
  aspects?: MightAspect[];
}

/** Выбор аспекта остаётся за Рассказчиком. Переменные ступени задаются вручную. */
function MightSelect({ label, value, onChange, aspects = [] }: {
  label: string;
  value: MightStep | "";
  onChange: (value: MightStep | "") => void;
  aspects?: MightAspect[];
}) {
  return (
    <label className="lp-give__name">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as MightStep | "")}>
        <option value="">Без сравнения</option>
        {MIGHT_STEPS.map((step) => (
          <option key={step} value={step}>
            {MIGHT_NAMES[step]}{aspects.filter((a) => a.level === step && a.name).map((a) => ` · ${a.name}`).join("")}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SourceMight({ source, value, onChange }: {
  source: ConsequenceSource;
  value: MightStep | "";
  onChange: (value: MightStep | "") => void;
}) {
  return <MightSelect label={`Могущество источника · ${source.name}`} value={value} onChange={onChange} aspects={source.aspects} />;
}

export function HeroMight({ heroId, label, value, onChange }: {
  heroId: number;
  label: string;
  value: MightStep | "";
  onChange: (value: MightStep | "") => void;
}) {
  const sheet = useLitmSheet(heroId);
  return <MightSelect label={`Могущество героя · ${label}`} value={value} onChange={onChange} aspects={heroAspects(sheet)} />;
}

function heroAspects(sheet: LitMCharacterData | null): MightAspect[] {
  if (!sheet) return [];
  return [...sheet.themes, ...sheet.storyThemes, sheet.fellowshipTheme].flatMap((t) => t.power && t.power !== "variable"
    ? [{ name: t.name, level: t.power }]
    : []);
}
