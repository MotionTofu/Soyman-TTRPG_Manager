import { useRef, type ReactNode } from "react";
import { addToBag } from "../bag";
import { extractEnglishName, KIND_DEFS } from "../compendium";
import { openEntityMenu } from "../pageMenu";
import type { CompendiumEntry } from "../types";
import { MentionText } from "./mentions/MentionText";
import { EffectList } from "./dnd/EffectList";
import { grantsFromEntry } from "./dnd/dndGrants";
import { ABILITY_LABELS } from "./dnd/AbilityScores";
import type { ContextMenuItem } from "./ContextMenu";
import { EMPTY_COST, type DndCheck, type DndCost, type DndEffect } from "./dnd/effects";
import "./compendium-d.css";

export function entryValue(entry: CompendiumEntry, key: string): string {
  const value = entry.data[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const FACTS = [["damage", "Урон"], ["ac", "КЗ"], ["cost", "Цена"], ["weight", "Вес"], ["casting_time", "Время"], ["casting_timing", "Время"], ["range", "Дистанция"], ["duration", "Длительность"], ["uses", "Использования"], ["recharge", "Восстановление"]] as const;
export function compendiumFacts(entry: CompendiumEntry) {
  const facts = FACTS.map(([key, label]) => ({key, label, value:entryValue(entry,key)})).filter((fact) => fact.value);
  const attack = [entry.data.attack_melee && "рукопашная", entry.data.attack_ranged && "дальнобойная"].filter(Boolean).join(" · ");
  return { facts, attack };
}
export function CompendiumRefs({ refs }: {refs: {id:number;name:string;distance?:string}[]}) {
  return <MentionText text={refs.map((ref) => `[[compendium_entry:${ref.id}|${extractEnglishName(ref.name).name}]]${ref.distance ? ` ${ref.distance}` : ""}`).join(", ")} />;
}

const abilityLabel = (key:string)=>ABILITY_LABELS.find((ability)=>ability.key===key)?.label ?? key;
export function featBenefitSummary(entry:CompendiumEntry) {
  const grants=grantsFromEntry(entry,()=>null);
  return [grants.abilityIncrease ? `+${grants.abilityIncrease.amount} ${grants.abilityIncrease.options.map(abilityLabel).join("/")}` : "",grants.spells.length ? `${grants.spells.length} закл.` : "",grants.skills.join(", ")].filter(Boolean).join(" · ");
}
export function CompendiumGrantFields({entry}:{entry:CompendiumEntry}) {
  const grants=grantsFromEntry(entry,()=>null), increase=grants.abilityIncrease;
  if(!increase && !grants.spells.length && !grants.skills.length)return null;
  return <dl className="dnd-fields">
    {increase && <div><dt>Повышение</dt><dd>+{increase.amount} к {increase.options.map(abilityLabel).join(", ")}, не выше {increase.max}</dd></div>}
    {grants.spells.length>0 && <div><dt>Заклинания</dt><dd>{grants.spells.map((spell)=><span key={spell.id}>{spell.slotCircle ? `${spell.slotCircle} ` : ""}<CompendiumRefs refs={[spell]} />{" "}</span>)}</dd></div>}
    {grants.skills.length>0 && <div><dt>Навыки</dt><dd>{grants.skills.join(", ")}</dd></div>}
  </dl>;
}

/** Одна статья для раскрытой строки раздела и умения в профиле. */
export function CompendiumArticle({entry, parentName, typeLabel, onEdit, onCollapse, onDelete, onFavourite, actions, editing, children}: {
  entry:CompendiumEntry; parentName?:string; typeLabel?:string; onEdit?:()=>void; onCollapse?:()=>void;
  onDelete?:()=>void; onFavourite?:()=>void; editing?:boolean; children?:ReactNode;
  actions?:ContextMenuItem[];
}) {
  const more = useRef<HTMLButtonElement>(null);
  const source = entryValue(entry,"source");
  const requirement = entryValue(entry,"prerequisite");
  const {facts,attack} = compendiumFacts(entry);
  const label = typeLabel ?? (entry.kind === "mechanic_item" ? "Справочник" : KIND_DEFS[entry.kind]?.label ?? "Запись");
  function menu(x:number,y:number) {
    openEntityMenu({type:"compendium_entry",id:entry.id,name:entry.name},x,y,[
      {label:"Скопировать ссылку на запись",onClick:()=>navigator.clipboard?.writeText(`${location.origin}/systems/${entry.system_id}?section=${entry.section_id}&entry=${entry.id}`)},
      ...(onFavourite ? [{label:entry.favourite ? "Убрать из избранного" : "В избранное",onClick:onFavourite}] : []),
      ...(onEdit ? [{label:editing ? "Отменить редактирование" : "Править",onClick:onEdit}] : []),
      ...(actions ?? []),
      ...(onDelete ? [{label:"Удалить",danger:true,onClick:onDelete}] : []),
    ]);
  }
  return <article className="dnd-article" aria-label={`${label}: ${entry.name}`} onContextMenu={(event) => {
    if (event.shiftKey || window.getSelection()?.toString().trim() || (event.target as Element).closest("input,textarea,select,a,button,[contenteditable=true]")) return;
    event.preventDefault(); event.stopPropagation(); menu(event.clientX,event.clientY);
  }}>
    <header className="dnd-article__head"><div><h3>{entry.name || "Без названия"}</h3>{entry.name_original && <span className="dnd-article__original">{entry.name_original}</span>}</div>
      <div className="dnd-article__actions"><button type="button" className="d-btn d-btn--sm d-btn--ghost dnd-article__bag" onClick={()=>addToBag({type:"compendium_entry",id:entry.id,title:entry.name,kind:entry.kind,system_id:entry.system_id,section_id:entry.section_id})}>В мешок</button>
        {onEdit && <button type="button" className="d-btn d-btn--sm" onClick={onEdit}>{editing ? "Отмена" : "Править"}</button>}
        <button type="button" className="d-btn d-btn--sm" aria-label={`Ещё действия: ${entry.name}`} ref={more} onClick={()=>{const r=more.current!.getBoundingClientRect();menu(r.left,r.bottom);}}>⋯</button>
        {onCollapse && <button type="button" className="d-btn d-btn--sm d-btn--ghost dnd-article__collapse" onClick={onCollapse}>Свернуть ▴</button>}
      </div>
    </header>
    <div className="dnd-article__passport"><span>{label}</span>{[entryValue(entry,"category") || parentName,source].filter(Boolean).map((text,index)=><span key={index}>· {text}</span>)}</div>
    {!editing && <>
      {(facts.length > 0 || attack) && <dl className="dnd-facts">{facts.map((fact)=><div key={fact.key}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}{attack && <div><dt>Атака</dt><dd>{attack}</dd></div>}</dl>}
      {requirement && <dl className="dnd-requirement"><dt>Требование</dt><dd><MentionText text={requirement} /></dd></dl>}
    </>}
    <div className="dnd-article__body">{children ?? <>
      {(Array.isArray(entry.data.effects) || Array.isArray(entry.data.checks) || entry.data.cost) && <EffectList systemId={entry.system_id} checks={(entry.data.checks as DndCheck[]) ?? []} effects={(entry.data.effects as DndEffect[]) ?? []} cost={(entry.data.cost as DndCost) ?? EMPTY_COST} edit={false} onChange={()=>{}} />}
      {entry.description && <MentionText text={entry.description} />}
    </>}</div>
    {!editing && source && <footer className="dnd-article__source">Источник · {source}</footer>}
  </article>;
}
