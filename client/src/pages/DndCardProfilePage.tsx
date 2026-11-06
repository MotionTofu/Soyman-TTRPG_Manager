import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { addToBag } from "../bag";
import type { Crumb } from "../components/Breadcrumbs";
import { EntityPage } from "../components/EntityPage";
import { CardPicture } from "../components/dnd/DndCards";
import { EmptyState } from "../components/EmptyState";
import { LoadErrorCard } from "../components/Loadable";
import { Modal } from "../components/Modal";
import { EntryImagesTab } from "../components/EntryImagesTab";
import { MentionsTab } from "../components/MentionsTab";
import { MentionText } from "../components/mentions/MentionText";
import { ProfileBlock, ProfileHero } from "../components/profiles/ProfileParts";
import { DndBasics, DndDescription, DndEquipment, DndFeatures, DndProfileProgression, DndReference, DndSubclassCards } from "../components/profiles/DndProfileParts";
import { profileNames, profileProgression, profileRefs } from "../components/profiles/dndProfileData";
import { entryValue } from "../components/compendiumArticleData";
import { useAction, useEntity, useResource, write } from "../data/hooks";
import { compendiumAffects, compendiumMembershipAffects, compendiumPaths } from "../data/compendiumEntries";
import { useTabState } from "../hooks/useTabState";
import type { CompendiumEntry, System, SystemSection } from "../types";
import "./dnd-profile.css";

const NO_ENTRIES: CompendiumEntry[] = [];
const NO_SECTIONS: SystemSection[] = [];
const TABS = ["Досье", "Развитие", "Подклассы", "Галерея", "Упоминания"] as const;
const SPECIES_TABS = ["Досье", "Галерея", "Упоминания"] as const;
const SUBCLASS_TABS = TABS.filter((tab) => tab !== "Подклассы");

export function DndCardProfilePage() {
  const { id, entryId } = useParams();
  const systemId = Number(id), cardId = Number(entryId);
  const navigate = useNavigate();
  const run = useAction();
  const [largeCard, setLargeCard] = useState(false);
  const state = useEntity<CompendiumEntry>("compendium_entry", Number.isFinite(cardId) ? cardId : null);
  const entry = state.data;
  const system = useResource<System>(Number.isFinite(systemId) ? `/systems/${systemId}` : null).data;
  const sections = useResource<SystemSection[]>(Number.isFinite(systemId) ? compendiumPaths.sections(systemId) : null).data ?? NO_SECTIONS;
  const sectionEntries = useResource<CompendiumEntry[]>(entry ? compendiumPaths.sectionEntries(systemId, entry.section_id) : null).data ?? NO_ENTRIES;
  const tabNames = entry?.kind === "species" ? SPECIES_TABS : entry?.kind === "subclass" ? SUBCLASS_TABS : TABS;
  const [tab, selectTab] = useTabState<(typeof TABS)[number]>(tabNames, "Досье");

  if (state.error && !entry) return <LoadErrorCard message={<>Карта не загрузилась: {state.error}</>} onRetry={state.reload} />;
  if (!entry) return <p className="muted">Загружаю карту…</p>;
  if (entry.system_id !== systemId || !["class", "subclass", "species"].includes(entry.kind)) return <EmptyState kind="error" title="Это не карточный профиль" hint="Проверьте адрес карты." />;

  const section = sections.find((candidate) => candidate.id === entry.section_id);
  const parentClass = entry.kind === "subclass" ? sectionEntries.find((candidate) => candidate.id === entry.parent_id && candidate.kind === "class") : undefined;
  const subclasses = sectionEntries.filter((candidate) => entry.kind === "class" && candidate.kind === "subclass" && candidate.parent_id === entry.id).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  // Те же дети feature и порядок, что loadDndClassFeatures/loadDndSpeciesFeatures;
  // ресурс раздела подписан на правку, поэтому не держит вторую копию записи.
  const features = sectionEntries.filter((candidate) => candidate.kind === "feature" && candidate.parent_id === entry.id).sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.position - b.position);
  const peers = sectionEntries.filter((candidate) => candidate.kind === entry.kind && (entry.kind !== "subclass" || candidate.parent_id === entry.parent_id)).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const index = peers.findIndex((candidate) => candidate.id === entry.id);
  const neighbour = (delta: number) => index >= 0 && peers.length > 1 ? { href: `/systems/${systemId}/entries/${peers[(index + delta + peers.length) % peers.length].id}`, name: peers[(index + delta + peers.length) % peers.length].name } : undefined;
  const kindLabel = entry.kind === "class" ? "Класс" : entry.kind === "subclass" ? "Подкласс" : "Вид";
  const crumbs: Crumb[] = [
    { label: "Системы", to: "/systems" },
    ...(system ? [{ label: system.name, to: `/systems/${system.id}` }] : []),
    ...(section ? [{ label: section.name, to: `/systems/${systemId}?section=${section.id}` }] : []),
    ...(parentClass ? [{ label: parentClass.name, to: `/systems/${systemId}/entries/${parentClass.id}` }] : []),
    { label: entry.name },
  ];
  const edit = (target: CompendiumEntry = entry) => navigate(`/systems/${systemId}?section=${target.section_id}&entry=${target.id}&edit=1`);
  async function addChild(kind: "feature" | "subclass") {
    const created = await run(() => write.post<CompendiumEntry>(`/systems/${systemId}/entries`, { section_id: entry!.section_id, parent_id: entry!.id, kind, name: "", level: kind === "feature" ? 1 : null, data: {}, description: "" }), { affects: compendiumMembershipAffects(systemId), retry: false });
    if (created) edit(created);
  }
  const tags = entry.kind === "species" ? [entryValue(entry, "size"), ...profileRefs(entry.data.creature_type).map((ref) => ref.name)] : [entryValue(entry, "hit_die"), profileNames(entry.data.primary_abilities), entryValue(entry, "subclass_level") ? `Подкласс с ${entryValue(entry, "subclass_level")} ур.` : ""];
  const card = <button type="button" className="profile-cover dnd-card-cover" onClick={() => setLargeCard(true)} aria-label={`Открыть карту «${entry.name}» крупно`}><CardPicture id={entry.id} name={entry.name} card={entry.avatar_image_url ?? null} /><span className="profile-cover__caption">Карта {entry.kind === "species" ? "вида" : "класса"} · щелчок — крупно</span></button>;

  return <div className="dnd-card-profile"><EntityPage crumbs={crumbs} entityType="compendium_entry" title={entry.name} profile={{ id: entry.id, previous: neighbour(-1), next: neighbour(1) }}
    tabs={tabNames.map((id) => ({ id, count: id === "Развитие" ? profileProgression(entry)?.rows.length : id === "Подклассы" ? subclasses.length : undefined }))} tab={tab} onTab={(value) => selectTab(value as (typeof TABS)[number])}
    actions={[
      { label: "Править запись и карту", onClick: () => edit() },
      { label: entry.favourite ? "Убрать из избранного" : "В избранное", onClick: async () => { await run(() => write.put(`/systems/entries/${entry.id}/favourite`, { favourite: !entry.favourite }), { affects: compendiumAffects(entry) }); state.reload(); } },
      { label: "В мешок", onClick: () => addToBag({ type: "compendium_entry", id: entry.id, title: entry.name, kind: entry.kind, system_id: entry.system_id, section_id: entry.section_id }) },
    ]}
    overlays={largeCard && <Modal className="dc-card-image-modal" ariaLabel={`Изображение карты «${entry.name}»`} onClose={() => setLargeCard(false)}><button type="button" className="dc-card-image-close" aria-label="Закрыть" onClick={() => setLargeCard(false)}>×</button><CardPicture id={entry.id} name={entry.name} card={entry.avatar_image_url ?? null} /></Modal>}
  >
    {tab === "Досье" && <>
      <ProfileHero type="compendium_entry" typeLabel={kindLabel} name={entry.name} subtype={entryValue(entry, "source")} labels={tags.filter(Boolean).map((tag) => <span className="gch" key={tag}>{tag}</span>)} cover={card}>
        {entryValue(entry, "short_description") && <div className="dnd-profile-short"><span className="d-note">В двух словах</span> <MentionText text={entryValue(entry, "short_description")} /></div>}
        <DndBasics entry={entry} features={features} onEdit={() => edit()} />
      </ProfileHero>
      <DndFeatures key={entry.id} entry={entry} features={features} onEdit={edit} onAdd={() => void addChild("feature")} onProgression={entry.kind !== "species" ? () => selectTab("Развитие") : undefined} />
      {entry.kind === "class" && <ProfileBlock title="Подклассы" count={subclasses.length} actions={<button type="button" className="d-btn d-btn--sm" onClick={() => void addChild("subclass")}>+ Подкласс</button>}><DndSubclassCards entries={subclasses} /></ProfileBlock>}
      <div className={entry.kind === "species" ? undefined : "profile-columns"}><DndDescription key={entry.id} entry={entry} onEdit={() => edit()} />{entry.kind !== "species" && <DndEquipment entry={entry} onEdit={() => edit()} />}</div>
      <DndReference entry={entry} onEdit={() => edit()} />
    </>}
    {tab === "Развитие" && <DndProfileProgression key={entry.id} entry={entry} features={features} subclasses={subclasses} onEdit={() => edit()} onEditFeature={edit} />}
    {tab === "Подклассы" && entry.kind === "class" && <ProfileBlock title="Подклассы" count={subclasses.length} actions={<button type="button" className="d-btn d-btn--sm" onClick={() => void addChild("subclass")}>+ Подкласс</button>}><DndSubclassCards entries={subclasses} large /></ProfileBlock>}
    {tab === "Галерея" && <div className="profile-gallery"><EntryImagesTab entryId={entry.id} entryName={entry.name} entryKind={entry.kind} avatarUrl={entry.avatar_image_url ?? null} /></div>}
    {tab === "Упоминания" && <MentionsTab entityType="compendium_entry" entityId={entry.id} />}
  </EntityPage></div>;
}
