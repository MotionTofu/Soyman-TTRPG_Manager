import { useState } from "react";
import { useResource } from "../data/hooks";
import { ProfileBlock, ProfileEntityLink } from "./profiles/ProfileParts";
import { MentionText } from "./mentions/MentionText";
import { TypeGlyph } from "./TypeGlyph";

// "Упоминания" tab for Being/Location/Community/Artifact pages: lists every
// session whose Задумка/Основные события text @-mentions this entity.
export function MentionsTab({ entityType, entityId }: { entityType: string; entityId: number }) {
  const state = useResource<{type:string;id:number;name:string;excerpt:string}[]>(`/links/profile-mentions?type=${entityType}&id=${entityId}`);
  const [filter,setFilter] = useState("Все");
  const groups = [
    { title:"Сессии",rows:(state.data ?? []).filter((s) => s.type === "session") },
    { title:"Сцены",rows:(state.data ?? []).filter((s) => s.type === "scene") },
    { title:"Статьи",rows:(state.data ?? []).filter((s) => s.type !== "session" && s.type !== "scene") },
  ];

  if (state.error && !state.data) {
    return (
      <div className="card row">
        <span className="muted">Не удалось загрузить упоминания: {state.error}</span>
        <button onClick={state.reload}>Повторить</button>
      </div>
    );
  }
  if (!state.data) return <div className="card muted">Загрузка…</div>;

  return (
    <div className="profile-mentions">
      <div className="profile-links__head"><h2 className="d-plate">Упоминания</h2><div className="d-seg d-seg--scroll" role="group" aria-label="Виды упоминаний">{["Все",...groups.filter((g) => g.rows.length).map((g) => g.title)].map((t) => <button type="button" key={t} className={filter === t ? "active" : undefined} onClick={() => setFilter(t)}>{t}</button>)}</div></div>
      {state.data.length === 0 && <p className="muted">Сессии, сцены и статьи с упоминанием этой сущности появятся здесь.</p>}
      {groups.filter((g) => g.rows.length && (filter === "Все" || filter === g.title)).map((g) => <ProfileBlock key={g.title} title={g.title} count={g.rows.length}>{g.rows.map((s) => <div className="profile-link-row" key={`${s.type}:${s.id}`}><TypeGlyph type={s.type} /><ProfileEntityLink type={s.type} id={s.id} name={s.name} /><span className="profile-link-row__note"><MentionText text={s.excerpt} /></span></div>)}</ProfileBlock>)}
    </div>
  );
}
