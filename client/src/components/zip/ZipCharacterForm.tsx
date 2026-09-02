// @ts-nocheck
import { useMemo } from "react";
import type { ZipCharacterData, ZipCreatureData, ZipEquipmentItem, ZipFeature, ZipGiftInstance } from "../../types";
import { mod, parseNum, bestMod, resilienceMax, defenseCalc, carryLimit, languagesCount, encumbrance, hasTalentByName } from "./zipDerived";

export function emptyZipCharacter(): ZipCharacterData {
  return {
    systemId: null,
    characterName: "",
    playerName: "",
    abilities: { tel: "10", lov: "10", raz: "10" },
    keyAbility: "tel",
    level: "1",
    experience: "0",
    skills: { atletika: "1", ulovki: "1", znaniya: "1", obschenie: "1" },
    specialization: "",
    specializationPoints: "0",
    characterTypeId: null,
    characterTypeName: "",
    talents: [],
    talisman: "",
    talismanBurned: false,
    health: { resilienceCurrent: "", telCurrent: "", razCurrent: "", lovCurrent: "" },
    defenseMisc: "0",
    carry: { extraSlots: "0" },
    languages: [],
    equipment: [],
    coins: "",
    hiredMercs: [],
    gifts: [],
    echo: "0",
    notes: "",
  };
}

export function normalizeZipCharacter(raw: unknown): ZipCharacterData {
  const d = (raw ?? {}) as Record<string, unknown>;
  const base = emptyZipCharacter();
  return {
    ...base,
    ...d,
    abilities: { ...base.abilities, ...(d.abilities as Record<string, string> | undefined) },
    skills: { ...base.skills, ...(d.skills as Record<string, string> | undefined) },
    health: { ...base.health, ...(d.health as Record<string, string> | undefined) },
    carry: { ...base.carry, ...(d.carry as Record<string, string> | undefined) },
    talents: Array.isArray(d.talents) ? (d.talents as ZipFeature[]) : base.talents,
    equipment: Array.isArray(d.equipment) ? (d.equipment as ZipEquipmentItem[]) : base.equipment,
    gifts: Array.isArray(d.gifts) ? (d.gifts as ZipGiftInstance[]) : base.gifts,
    languages: Array.isArray(d.languages) ? (d.languages as string[]) : base.languages,
    hiredMercs: Array.isArray(d.hiredMercs) ? (d.hiredMercs as ZipCharacterData["hiredMercs"]) : base.hiredMercs,
  } as ZipCharacterData;
}

export function emptyZipCreature(): ZipCreatureData {
  return {
    name: "",
    level: "1",
    resilience: "1d8",
    competence: "1",
    meleeAttack: "0",
    rangedAttack: "0",
    damage: "d6",
    defense: "10",
    resolve: "10",
    behavior: "",
    features: [],
    equipment: "",
    habitat: "",
    treasure: "",
    notes: "",
  };
}
export function normalizeZipCreature(raw: unknown): ZipCreatureData {
  const d = (raw ?? {}) as Record<string, unknown>;
  return { ...emptyZipCreature(), ...d } as ZipCreatureData;
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="badge tag" style={{ fontSize: "var(--fs-meta)" }}>
      {label}: {value}
    </span>
  );
}

export function ZipCharacterView({ value, onQuickUpdate }: { value: ZipCharacterData; onQuickUpdate?: (patch: Partial<ZipCharacterData>) => void }) {
  const tel = parseNum(value.abilities.tel, 10);
  const lov = parseNum(value.abilities.lov, 10);
  const raz = parseNum(value.abilities.raz, 10);
  const telM = mod(tel), lovM = mod(lov), razM = mod(raz);
  const best = bestMod(tel, lov, raz);
  const lvl = parseNum(value.level, 1);
  const resMax = resilienceMax(best, lvl);
  const has = (n: string) => hasTalentByName(value.talents, n);
  const armorBonus = value.equipment.filter((e) => e.equipped && e.armorBonus).reduce((a, e) => a + parseNum(e.armorBonus, 0), 0);
  const hasBackpack = value.equipment.some((e) => e.name.toLowerCase().includes("рюкзак"));
  const atletika = parseNum(value.skills.atletika, 1);
  const def = defenseCalc(lovM, armorBonus, has, razM, telM, parseNum(value.defenseMisc, 0));
  const cl = carryLimit(telM, has("Носильщик"), atletika, hasBackpack);
  const used = value.equipment.reduce((a, e) => a + parseNum(e.load, 0) * (parseNum(e.qty, 1) || 1), 0);
  const enc = encumbrance(used, cl);
  const langCnt = languagesCount(razM);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <StatRow label="ТЕЛ" value={`${tel} (${telM >= 0 ? "+" : ""}${telM})`} />
        <StatRow label="ЛОВ" value={`${lov} (${lovM >= 0 ? "+" : ""}${lovM})`} />
        <StatRow label="РАЗ" value={`${raz} (${razM >= 0 ? "+" : ""}${razM})`} />
        <StatRow label="Стойкость max" value={resMax} />
        <StatRow label="Защита" value={def} />
        <StatRow label="Нагрузка" value={`${used}/${cl}${enc.overloaded ? ` (${enc.penalty})` : ""}`} />
        <StatRow label="Языки" value={langCnt} />
        <StatRow label="Эхо" value={value.echo} />
      </div>
      {value.characterTypeName && <div><b>Типаж:</b> {value.characterTypeName}</div>}
      {value.talents.length > 0 && <div><b>Таланты:</b> {value.talents.map((t) => t.name).join(", ")}</div>}
      {value.talisman && <div><b>Талисман:</b> {value.talisman} {value.talismanBurned ? "(утрачен)" : ""}</div>}
      {value.gifts.length > 0 && (
        <div>
          <b>Дары:</b> {value.gifts.map((g) => `${g.name} (Сл ${g.difficulty}, эхо ${value.echo})`).join("; ")}
        </div>
      )}
      {value.equipment.length > 0 && (
        <div>
          <b>Снаряжение:</b> {value.equipment.map((e) => `${e.name} ⚖${e.load} ${e.equipped ? "●" : "○"}`).join(", ")}
        </div>
      )}
      {value.notes && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{value.notes}</div>}
      {onQuickUpdate && (
        <div className="row" style={{ gap: 6 }}>
          <button className="comp-mini" onClick={() => onQuickUpdate({ talismanBurned: !value.talismanBurned })}>
            {value.talismanBurned ? "Восстановить талисман" : "Сжечь талисман"}
          </button>
        </div>
      )}
    </div>
  );
}

export function ZipCharacterEdit({ value, onChange }: { value: ZipCharacterData; onChange: (v: ZipCharacterData) => void }) {
  const tel = parseNum(value.abilities.tel, 10);
  const lov = parseNum(value.abilities.lov, 10);
  const raz = parseNum(value.abilities.raz, 10);
  const best = bestMod(tel, lov, raz);
  const lvl = parseNum(value.level, 1);
  const derived = useMemo(() => {
    const has = (n: string) => hasTalentByName(value.talents, n);
    const armorBonus = value.equipment.filter((e) => e.equipped && e.armorBonus).reduce((a, e) => a + parseNum(e.armorBonus, 0), 0);
    const def = defenseCalc(mod(lov), armorBonus, has, mod(raz), mod(tel), parseNum(value.defenseMisc, 0));
    return { best, resMax: resilienceMax(best, lvl), def };
  }, [value, best, lvl, lov, raz, tel]);

  function set(path: string, val: string) {
    const next = structuredClone(value) as ZipCharacterData;
    const parts = path.split(".");
    let cur: Record<string, unknown> = next as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] as Record<string, unknown>;
    cur[parts[parts.length - 1]] = val;
    onChange(next);
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <input placeholder="Имя персонажа" value={value.characterName} onChange={(e) => onChange({ ...value, characterName: e.target.value })} />
        <input placeholder="Игрок" value={value.playerName} onChange={(e) => onChange({ ...value, playerName: e.target.value })} />
        <select value={value.keyAbility} onChange={(e) => onChange({ ...value, keyAbility: e.target.value as ZipCharacterData["keyAbility"] })}>
          <option value="tel">ТЕЛ</option>
          <option value="lov">ЛОВ</option>
          <option value="raz">РАЗ</option>
        </select>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <label>ТЕЛ <input style={{ width: 60 }} value={value.abilities.tel} onChange={(e) => set("abilities.tel", e.target.value)} /></label>
        <label>ЛОВ <input style={{ width: 60 }} value={value.abilities.lov} onChange={(e) => set("abilities.lov", e.target.value)} /></label>
        <label>РАЗ <input style={{ width: 60 }} value={value.abilities.raz} onChange={(e) => set("abilities.raz", e.target.value)} /></label>
        <label>Уровень <input style={{ width: 60 }} value={value.level} onChange={(e) => set("level", e.target.value)} /></label>
        <label>Опыт <input style={{ width: 60 }} value={value.experience} onChange={(e) => set("experience", e.target.value)} /></label>
        <span className="muted">Стойкость max {derived.resMax} · Защита {derived.def} · best {derived.best}</span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <label>Атлетика <input style={{ width: 60 }} value={value.skills.atletika} onChange={(e) => set("skills.atletika", e.target.value)} /></label>
        <label>Уловки <input style={{ width: 60 }} value={value.skills.ulovki} onChange={(e) => set("skills.ulovki", e.target.value)} /></label>
        <label>Знания <input style={{ width: 60 }} value={value.skills.znaniya} onChange={(e) => set("skills.znaniya", e.target.value)} /></label>
        <label>Общение <input style={{ width: 60 }} value={value.skills.obschenie} onChange={(e) => set("skills.obschenie", e.target.value)} /></label>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input placeholder="Специализация (напр. химия)" value={value.specialization} onChange={(e) => onChange({ ...value, specialization: e.target.value })} style={{ flex: 1 }} />
        <label>пункты <input style={{ width: 60 }} value={value.specializationPoints} onChange={(e) => set("specializationPoints", e.target.value)} /></label>
        <input placeholder="Типаж" value={value.characterTypeName} onChange={(e) => onChange({ ...value, characterTypeName: e.target.value })} />
        <input placeholder="Талисман" value={value.talisman} onChange={(e) => onChange({ ...value, talisman: e.target.value })} />
        <label><input type="checkbox" checked={value.talismanBurned} onChange={(e) => onChange({ ...value, talismanBurned: e.target.checked })} /> утрачен</label>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input placeholder="Языки через запятую" value={value.languages.join(", ")} onChange={(e) => onChange({ ...value, languages: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} style={{ flex: 1 }} />
        <label>Эхо <input style={{ width: 60 }} value={value.echo} onChange={(e) => set("echo", e.target.value)} /></label>
        <label>Защита доп. <input style={{ width: 60 }} value={value.defenseMisc} onChange={(e) => set("defenseMisc", e.target.value)} /></label>
        <label>$ <input style={{ width: 80 }} value={value.coins} onChange={(e) => set("coins", e.target.value)} /></label>
      </div>
      <textarea placeholder="Таланты — по одному на строку: Название | описание" rows={2} value={value.talents.map((t) => `${t.name}|${t.description}`).join("\n")} onChange={(e) => {
        const talents: ZipFeature[] = e.target.value.split("\n").filter(Boolean).map((line) => {
          const [name, desc] = line.split("|");
          return { entryId: null, name: (name ?? "").trim(), description: (desc ?? "").trim() };
        });
        onChange({ ...value, talents });
      }} />
      <textarea placeholder="Снаряжение — по одному на строку: Имя | нагрузка | урон | примечание | equipped(1/0)" rows={3} value={value.equipment.map((eq) => `${eq.name}|${eq.load}|${eq.damage ?? ""}|${eq.notes}|${eq.equipped ? 1 : 0}`).join("\n")} onChange={(e) => {
        const equipment: ZipEquipmentItem[] = e.target.value.split("\n").filter(Boolean).map((line) => {
          const [name, load, dmg, notes, eq] = line.split("|");
          return { entryId: null, name: (name ?? "").trim(), qty: "1", weight: load ?? "0", load: (load ?? "0").trim(), cost: "", damage: dmg?.trim(), equipped: eq === "1", notes: (notes ?? "").trim() };
        });
        onChange({ ...value, equipment });
      }} />
      <textarea placeholder="Дары — по одному: Имя | сложность | подготовка" rows={2} value={value.gifts.map((g) => `${g.name}|${g.difficulty}|${g.preparationTurns}`).join("\n")} onChange={(e) => {
        const gifts: ZipGiftInstance[] = e.target.value.split("\n").filter(Boolean).map((line) => {
          const [name, diff, prep] = line.split("|");
          return { entryId: null, name: (name ?? "").trim(), difficulty: (diff ?? "12").trim(), enhancements: [], preparationTurns: (prep ?? "0").trim() };
        });
        onChange({ ...value, gifts });
      }} />
      <textarea placeholder="Заметки" rows={3} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
    </div>
  );
}

export function ZipCreatureView({ value, onQuickUpdate }: { value: ZipCreatureData; onQuickUpdate?: (patch: Partial<ZipCreatureData>) => void }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <span className="badge tag">Ур. {value.level}</span>
        <span className="badge tag">Стойкость {value.resilience}</span>
        <span className="badge tag">Комп +{value.competence}</span>
        <span className="badge tag">Атака {value.meleeAttack}/{value.rangedAttack}</span>
        <span className="badge tag">Защита {value.defense}</span>
        <span className="badge tag">Решимость {value.resolve}</span>
      </div>
      {value.features.length > 0 && (
        <div>
          <b>Особенности:</b> {value.features.map((f) => `${f.name}${f.description ? ` — ${f.description}` : ""}`).join("; ")}
        </div>
      )}
      {value.equipment && <div><b>Снаряжение:</b> {value.equipment}</div>}
      {value.behavior && <div><b>Поведение:</b> {value.behavior}</div>}
      {value.notes && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{value.notes}</div>}
      {onQuickUpdate && <div className="muted">Существо ведущего — погибает при 0 стойкости.</div>}
    </div>
  );
}

export function ZipCreatureEdit({ value, onChange }: { value: ZipCreatureData; onChange: (v: ZipCreatureData) => void }) {
  function set<K extends keyof ZipCreatureData>(k: K, v: ZipCreatureData[K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <input placeholder="Имя" value={value.name} onChange={(e) => set("name", e.target.value)} />
        <input placeholder="Уровень" style={{ width: 80 }} value={value.level} onChange={(e) => set("level", e.target.value)} />
        <input placeholder="Стойкость Nd8" style={{ width: 100 }} value={value.resilience} onChange={(e) => set("resilience", e.target.value)} />
        <input placeholder="Комп" style={{ width: 80 }} value={value.competence} onChange={(e) => set("competence", e.target.value)} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input placeholder="Атака ближ" style={{ width: 80 }} value={value.meleeAttack} onChange={(e) => set("meleeAttack", e.target.value)} />
        <input placeholder="Атака дальн" style={{ width: 80 }} value={value.rangedAttack} onChange={(e) => set("rangedAttack", e.target.value)} />
        <input placeholder="Урон" style={{ width: 100 }} value={value.damage} onChange={(e) => set("damage", e.target.value)} />
        <input placeholder="Защита" style={{ width: 80 }} value={value.defense} onChange={(e) => set("defense", e.target.value)} />
        <input placeholder="Решимость" style={{ width: 80 }} value={value.resolve} onChange={(e) => set("resolve", e.target.value)} />
      </div>
      <input placeholder="Поведение (напр. миролюбивое → перебросить враждебную)" value={value.behavior} onChange={(e) => set("behavior", e.target.value)} />
      <textarea placeholder="Особенности — по строке: Название | описание" rows={3} value={value.features.map((f) => `${f.name}|${f.description}`).join("\n")} onChange={(e) => {
        const features: ZipFeature[] = e.target.value.split("\n").filter(Boolean).map((line) => {
          const [name, desc] = line.split("|");
          return { entryId: null, name: (name ?? "").trim(), description: (desc ?? "").trim() };
        });
        onChange({ ...value, features });
      }} />
      <input placeholder="Снаряжение" value={value.equipment} onChange={(e) => set("equipment", e.target.value)} />
      <div className="row" style={{ gap: 8 }}>
        <input placeholder="Ареал" value={value.habitat} onChange={(e) => set("habitat", e.target.value)} style={{ flex: 1 }} />
        <input placeholder="Сокровище" value={value.treasure} onChange={(e) => set("treasure", e.target.value)} style={{ flex: 1 }} />
      </div>
      <textarea placeholder="Заметки" rows={3} value={value.notes} onChange={(e) => set("notes", e.target.value)} />
    </div>
  );
}
