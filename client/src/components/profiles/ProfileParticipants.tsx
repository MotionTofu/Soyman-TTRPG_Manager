import { useState, type DragEvent, type ReactNode } from "react";
import { ProfileBlock, ProfileEntityLink, ProfileTypeGlyph } from "./ProfileParts";
import { TYPE_LABELS } from "../../graphTypes";
import { EntityMenuButton } from "../PageContextMenu";
import { MentionPickerModal } from "../mentions/MentionPickerModal";
import type { SearchResult } from "../../types";

export default function ProfileParticipants({ title,items,settingId,link,removeLink,dragOver,setDragOver,handleDrop,confirmDialog }: {
  title:string;items:{relationId:number;type:string;id:number;label:string}[];settingId?:number;
  link:(result:SearchResult) => Promise<void>;removeLink:(id:number) => Promise<void>;
  dragOver:boolean;setDragOver:(value:boolean) => void;handleDrop:(e:DragEvent<HTMLDivElement>) => Promise<void>;confirmDialog:ReactNode;
}) {
  const [picking,setPicking] = useState(false);
  return <ProfileBlock title={title} count={items.length} actions={<button type="button" className="d-btn d-btn--sm" onClick={() => setPicking(true)}>+ Участник</button>}>
    {confirmDialog}
    <div className={`profile-participants${dragOver ? " drag-over" : ""}`} onDragOver={(e) => { e.preventDefault();setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
      {items.length ? items.map((it) => <div className="profile-participant" key={it.relationId}><ProfileTypeGlyph type={it.type} /><ProfileEntityLink type={it.type} id={it.id} name={it.label} /><span className="profile-participant-type">{it.type === "location" ? "место" : (TYPE_LABELS[it.type] ?? it.type).toLocaleLowerCase()}</span><EntityMenuButton entity={{type:it.type,id:it.id,name:it.label}} local={[{label:"Убрать из участников",onClick:() => void removeLink(it.relationId),danger:true}]} /></div>) : <p className="muted">Добавьте участника или перетащите сущность сюда.</p>}
    </div>
    {picking && <MentionPickerModal initialQuery="" defaultSettingId={settingId} heading="Участник события" direct onClose={() => setPicking(false)} onPick={(result) => { void link(result as SearchResult);setPicking(false); }} />}
  </ProfileBlock>;
}
