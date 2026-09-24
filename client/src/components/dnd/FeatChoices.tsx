import { useEffect, useState, type ReactNode } from "react";
import type { CompendiumEntry } from "../../types";
import { readResource } from "../../data/imperative";
import { ABILITY_KEY_ABBR } from "./effects";
import type { SourceGrants } from "./dndGrants";
import { PickHead, PickList, SearchField, type PickRow } from "./wizardUi";
import type { SkillRow } from "./useDndSkills";
import { weaponMasteryName } from "./StartingEquipmentPicker";
import {
  ALL_PARTS,
  choiceClassIds,
  featSpellAbility,
  featSpellList,
  resistanceChoice,
  spellCandidates,
  spellChoiceCount,
  type FeatCtx,
  type FeatPart,
  type FeatPick,
} from "./featPick";

/**
 * Блок выбора при взятии черты — визард, шаг «Черта» повышения уровня и
 * окно листа. Расчёт и запись в лист — `featPick.ts`.
 */

const MENTAL = ["int", "wis", "cha"] as const;

function useClassNames(ids: number[]): Record<number, string> {
  const [names, setNames] = useState<Record<number, string>>({});
  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    Promise.all(
      key
        .split(",")
        .filter(Boolean)
        .map((id) =>
          readResource<CompendiumEntry>(`/systems/entries/${id}`)
            .then((e) => [Number(id), e.name] as const)
            .catch(() => null)
        )
    ).then((rows) => {
      if (alive) setNames(Object.fromEntries(rows.filter((r): r is readonly [number, string] => !!r)));
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return names;
}

export function FeatChoices({
  entry,
  grants: g,
  ctx,
  pick,
  onChange,
  parts = ALL_PARTS,
  spellIndex,
  tools,
  weapons,
  skills,
}: {
  entry: CompendiumEntry;
  grants: SourceGrants;
  ctx: FeatCtx;
  pick: FeatPick;
  onChange: (next: FeatPick) => void;
  parts?: FeatPart[];
  spellIndex: CompendiumEntry[];
  tools: CompendiumEntry[];
  weapons: CompendiumEntry[];
  skills: SkillRow[];
}) {
  const has = (p: FeatPart) => parts.includes(p);
  const classNames = useClassNames(g.spellListChoice);
  const rc = resistanceChoice(entry);
  const [spellQuery, setSpellQuery] = useState("");
  const set = (patch: Partial<FeatPick>) => onChange({ ...pick, ...patch });
  // Квота 1 — замена, а не блок (как в визарде).
  const toggleIn = (list: string[], key: string, limit: number) =>
    list.includes(key) ? list.filter((k) => k !== key) : limit === 1 ? [key] : list.length < limit ? [...list, key] : list;
  const skillName = (k: string) => skills.find((r) => r.original === k)?.name ?? k;

  const inc = g.abilityIncrease;
  const spellAbility = featSpellAbility(g, pick, ctx);
  const blocks: ReactNode[] = [];

  if (has("ability") && inc) {
    blocks.push(
      <div key="ability" className="wz-feat-group">
        <PickHead
          label={g.saveFromAbility ? `+${inc.amount} и владение спасброском` : `+${inc.amount} к характеристике`}
          hint={`не выше ${inc.max}${g.spellAbilityFromIncrease ? " · ею же колдуются заклинания черты" : ""}`}
        />
        <div className="wz-chips">
          {inc.options.map((k) => {
            const now = ctx.abilities[k] ?? 10;
            const capped = now >= inc.max;
            const saveTaken = g.saveFromAbility && ctx.saves[k];
            return (
              <button
                key={k}
                type="button"
                className="wz-chip"
                aria-pressed={pick.ability === k}
                disabled={capped || saveTaken}
                title={capped ? `Уже ${inc.max}` : saveTaken ? "Спасбросок уже есть" : undefined}
                onClick={() => set({ ability: pick.ability === k ? undefined : k })}
              >
                {ABILITY_KEY_ABBR[k]} {now}
                {pick.ability === k ? ` → ${Math.min(inc.max, now + inc.amount)}` : ""}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (has("spellList") && g.spellListChoice.length > 0) {
    blocks.push(
      <div key="list" className="wz-feat-group">
        <PickHead label="Список заклинаний" hint="смена списка сбрасывает выбранные заклинания" />
        <div className="wz-seg" role="group" aria-label="Список заклинаний">
          {g.spellListChoice.map((id) => {
            const taken = ctx.takenLists.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={pick.spellList === id}
                disabled={taken}
                title={taken ? "Уже взят другой такой чертой" : undefined}
                onClick={() => set({ spellList: id, spells: pick.spellList === id ? pick.spells : {} })}
              >
                {classNames[id] ?? "…"}
                {taken ? " (уже взят)" : ""}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (has("spellAbility") && g.spellAbilityChoice) {
    blocks.push(
      <div key="sa" className="wz-feat-group">
        <PickHead label="Чем колдовать заклинания черты" />
        <div className="wz-chips">
          {MENTAL.map((k) => (
            <button key={k} type="button" className="wz-chip" aria-pressed={pick.spellAbility === k} onClick={() => set({ spellAbility: k })}>
              {ABILITY_KEY_ABBR[k]} {ctx.abilities[k] ?? 10}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (has("resist") && rc) {
    blocks.push(
      <div key="resist" className="wz-feat-group">
        <PickHead label="Сопротивление" picked={pick.resistances.length} total={rc.count} />
        <div className="wz-chips">
          {rc.options.map((n) => (
            <button
              key={n}
              type="button"
              className="wz-chip"
              aria-pressed={pick.resistances.includes(n)}
              onClick={() => set({ resistances: toggleIn(pick.resistances, n, rc.count) })}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (has("skills")) {
    const sc = g.skillChoice;
    if (sc) {
      const pool = sc.options.length ? sc.options : skills.map((r) => r.original);
      const rows: PickRow[] = pool.map((k) => ({
        key: k,
        title: skillName(k),
        picked: pick.skills.includes(k),
        disabled: (ctx.skills[k] ?? 0) >= 1,
        meta: (ctx.skills[k] ?? 0) >= 1 ? "уже есть" : undefined,
      }));
      blocks.push(
        <div key="skills" className="wz-feat-group">
          <PickHead label="Владение навыком" picked={pick.skills.length} total={sc.count} />
          <PickList rows={rows} full={pick.skills.length >= sc.count} collapse onToggle={(k) => set({ skills: toggleIn(pick.skills, k, sc.count) })} />
        </div>
      );
    }
    const soe = g.skillOrExpertise;
    if (soe) {
      const rows: PickRow[] = soe.options.map((k) => {
        const lvl = ctx.skills[k] ?? 0;
        return {
          key: k,
          title: skillName(k),
          picked: pick.skillOrExpertise.includes(k),
          disabled: lvl >= 2,
          meta: lvl >= 2 ? "уже компетентность" : lvl >= 1 ? "станет компетентностью" : "владение",
        };
      });
      blocks.push(
        <div key="soe" className="wz-feat-group">
          <PickHead label="Навык: владение или компетентность" picked={pick.skillOrExpertise.length} total={soe.count} />
          <PickList
            rows={rows}
            full={pick.skillOrExpertise.length >= soe.count}
            collapse
            onToggle={(k) => set({ skillOrExpertise: toggleIn(pick.skillOrExpertise, k, soe.count) })}
          />
        </div>
      );
    }
    if (g.expertiseChoice > 0) {
      // Компетентность — в навыке, которым владеешь (с учётом только что взятого).
      const owned = skills
        .map((r) => r.original)
        .filter((k) => g.allSkills || (ctx.skills[k] ?? 0) >= 1 || pick.skills.includes(k));
      const rows: PickRow[] = owned.map((k) => ({
        key: k,
        title: skillName(k),
        picked: pick.expertise.includes(k),
        disabled: (ctx.skills[k] ?? 0) >= 2,
        meta: (ctx.skills[k] ?? 0) >= 2 ? "уже компетентность" : undefined,
      }));
      blocks.push(
        <div key="exp" className="wz-feat-group">
          <PickHead label="Компетентность" picked={pick.expertise.length} total={g.expertiseChoice} />
          <PickList
            rows={rows}
            full={pick.expertise.length >= g.expertiseChoice}
            collapse
            onToggle={(k) => set({ expertise: toggleIn(pick.expertise, k, g.expertiseChoice) })}
          />
        </div>
      );
    }
  }

  const tc = g.toolChoice;
  if (has("tools") && tc) {
    const kinds = tc.group
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean);
    const pool = tools.filter((e) => kinds.length === 0 || kinds.includes(String(e.data.tool_kind)));
    const rows: PickRow[] = pool.map((e) => ({
      key: String(e.id),
      title: e.name,
      picked: pick.tools.includes(e.id),
      disabled: ctx.profNames.includes(e.name),
      meta: ctx.profNames.includes(e.name) ? "уже есть" : undefined,
    }));
    const picked = pick.tools.map(String);
    blocks.push(
      <div key="tools" className="wz-feat-group">
        <PickHead label={tc.group.replace("|", " или ") || "Инструменты"} picked={pick.tools.length} total={tc.count} />
        <PickList rows={rows} full={pick.tools.length >= tc.count} collapse onToggle={(k) => set({ tools: toggleIn(picked, k, tc.count).map(Number) })} />
      </div>
    );
  }

  if (has("mastery") && g.masteryChoice > 0) {
    const rows: PickRow[] = weapons.map((e) => ({
      key: String(e.id),
      title: e.name,
      meta: weaponMasteryName(e) || undefined,
      picked: pick.mastery.includes(e.id),
      disabled: ctx.masteredNames.includes(e.name),
    }));
    const picked = pick.mastery.map(String);
    blocks.push(
      <div key="mastery" className="wz-feat-group">
        <PickHead label="Оружейный приём" picked={pick.mastery.length} total={g.masteryChoice} hint="тип оружия можно сменить на долгом отдыхе" />
        <PickList
          rows={rows}
          full={pick.mastery.length >= g.masteryChoice}
          collapse
          onToggle={(k) => set({ mastery: toggleIn(picked, k, g.masteryChoice).map(Number) })}
        />
      </div>
    );
  }

  if (has("spells") && g.spellChoices.length > 0) {
    const listNeeded = (g.spellListChoice.length > 0 || g.spellListFrom != null) && featSpellList(g, pick, ctx) == null;
    if (listNeeded) {
      blocks.push(
        <p key="spells-wait" className="muted">
          {g.spellListFrom != null
            ? "Список берётся у черты «Посвящённый в магию» — её на листе нет или список не выбран."
            : "Сначала выберите список — заклинания появятся из него."}
        </p>
      );
    } else {
      g.spellChoices.forEach((c, i) => {
        const total = spellChoiceCount(c, ctx);
        const chosen = pick.spells[i] ?? [];
        const q = spellQuery.trim().toLowerCase();
        const cand = spellCandidates(spellIndex, c, choiceClassIds(c, g, pick, ctx)).filter(
          (e) => !q || e.name.toLowerCase().includes(q) || chosen.includes(e.id)
        );
        const rows: PickRow[] = cand.map((e) => {
          const known =
            ctx.knownSpellIds.includes(e.id) ||
            Object.entries(pick.spells).some(([j, ids]) => Number(j) !== i && ids.includes(e.id));
          return {
            key: String(e.id),
            title: e.name,
            meta:
              [(e.data.school as { name?: string } | undefined)?.name, e.data.ritual ? "ритуал" : "", known && !chosen.includes(e.id) ? "уже есть" : ""]
                .filter(Boolean)
                .join(" · ") || undefined,
            picked: chosen.includes(e.id),
            disabled: known && !chosen.includes(e.id),
          };
        });
        blocks.push(
          <div key={`sp${i}`} className="wz-feat-group">
            <PickHead
              label={c.level === 0 ? "Заговоры" : `Заклинания ${c.level} круга`}
              picked={chosen.length}
              total={total}
              hint={
                [c.freeCast ? "раз в долгий отдых без ячейки" : "", spellAbility ? `колдует ${ABILITY_KEY_ABBR[spellAbility]}` : ""]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
            {i === 0 && spellIndex.length > 0 && <SearchField value={spellQuery} onChange={setSpellQuery} placeholder="Поиск заклинания" />}
            <PickList
              rows={rows}
              full={chosen.length >= total}
              collapse
              onToggle={(k) => set({ spells: { ...pick.spells, [i]: toggleIn(chosen.map(String), k, total).map(Number) } })}
            />
          </div>
        );
      });
    }
  }

  return <div className="wz-feat-choices">{blocks}</div>;
}
