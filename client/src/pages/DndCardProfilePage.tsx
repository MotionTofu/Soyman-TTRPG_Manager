import { Link, useNavigate, useParams } from "react-router-dom";
import { addToBag } from "../bag";
import { Breadcrumbs, type Crumb } from "../components/Breadcrumbs";
import { CardGrid, CardSpread } from "../components/dnd/DndCards";
import { EmptyState } from "../components/EmptyState";
import { LoadErrorCard } from "../components/Loadable";
import { PageFrame } from "../components/PageFrame";
import { useEntity, useResource, write } from "../data/hooks";
import type { CompendiumEntry, System, SystemSection } from "../types";

const NO_ENTRIES: CompendiumEntry[] = [];
const NO_SECTIONS: SystemSection[] = [];

export function DndCardProfilePage() {
  const { id, entryId } = useParams();
  const systemId = Number(id);
  const cardId = Number(entryId);
  const navigate = useNavigate();
  const state = useEntity<CompendiumEntry>("compendium_entry", Number.isFinite(cardId) ? cardId : null);
  const entry = state.data;
  const system = useResource<System>(Number.isFinite(systemId) ? `/systems/${systemId}` : null).data;
  const sections = useResource<SystemSection[]>(Number.isFinite(systemId) ? `/systems/${systemId}/sections` : null).data ?? NO_SECTIONS;
  const sectionEntries = useResource<CompendiumEntry[]>(
    entry ? `/systems/${systemId}/entries?section_id=${entry.section_id}` : null
  ).data ?? NO_ENTRIES;
  const subclasses = entry?.kind === "class"
    ? sectionEntries.filter((candidate) => candidate.kind === "subclass" && candidate.parent_id === entry.id)
    : [];

  if (state.error && !entry) return <LoadErrorCard message={<>Карта не загрузилась: {state.error}</>} onRetry={state.reload} />;
  if (!entry) return <p className="muted">Загружаю карту…</p>;
  if (entry.system_id !== systemId || !["class", "subclass", "species"].includes(entry.kind)) {
    return <EmptyState kind="error" title="Это не карточный профиль" hint="Проверьте адрес карты." />;
  }

  const section = sections.find((candidate) => candidate.id === entry.section_id);
  const parentClass = entry.kind === "subclass"
    ? sectionEntries.find((candidate) => candidate.id === entry.parent_id && candidate.kind === "class")
    : undefined;
  const peers = sectionEntries
    .filter((candidate) => candidate.kind === entry.kind && (entry.kind !== "subclass" || candidate.parent_id === entry.parent_id))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const peerIndex = peers.findIndex((candidate) => candidate.id === entry.id);
  const previous = peerIndex >= 0 && peers.length > 1 ? peers[(peerIndex - 1 + peers.length) % peers.length] : null;
  const next = peerIndex >= 0 && peers.length > 1 ? peers[(peerIndex + 1) % peers.length] : null;
  const kindLabel = entry.kind === "class" ? "класс" : entry.kind === "subclass" ? "подкласс" : "вид";
  const crumbs: Crumb[] = [
    { label: "Системы", to: "/systems" },
    ...(system ? [{ label: system.name, to: `/systems/${system.id}` }] : []),
    ...(section ? [{ label: section.name, to: `/systems/${systemId}?section=${section.id}` }] : []),
    ...(parentClass ? [{ label: parentClass.name, to: `/systems/${systemId}/entries/${parentClass.id}` }] : []),
    { label: entry.name },
  ];

  const strip = subclasses.length > 0 ? (
    <div className="dc-substrip">
      <CardGrid
        collapsed
        options={subclasses
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, "ru"))
          .map((subclass) => ({ id: subclass.id, name: subclass.name, card: subclass.avatar_image_url ?? null }))}
        selectedId={null}
        onPick={(subclass) => navigate(`/systems/${systemId}/entries/${subclass.id}`)}
      />
    </div>
  ) : undefined;

  return (
    <div className="stack dnd-card-profile">
      <Breadcrumbs items={crumbs} />
      <PageFrame
        title={entry.name}
        actions={
          <>
            <button type="button" onClick={async () => {
              await write.put(`/systems/entries/${entry.id}/favourite`, { favourite: !entry.favourite });
              state.reload();
            }}>
              {entry.favourite ? "★ В избранном" : "☆ В избранное"}
            </button>
            <button type="button" onClick={() => addToBag({ type: "compendium_entry", id: entry.id, title: entry.name, kind: entry.kind, system_id: entry.system_id, section_id: entry.section_id })}>
              В мешок
            </button>
            <Link className="primary" to={`/systems/${systemId}?section=${entry.section_id}&entry=${entry.id}`}>
              Редактировать запись и карту
            </Link>
          </>
        }
      >
        {previous && next && (
          <nav className="dnd-card-profile-nav" aria-label={`Соседние записи: ${kindLabel}`}>
            <Link to={`/systems/${systemId}/entries/${previous.id}`} title={`Предыдущий ${kindLabel}`}>
              <span aria-hidden="true">←</span>
              <span>{previous.name}</span>
            </Link>
            <Link to={`/systems/${systemId}/entries/${next.id}`} title={`Следующий ${kindLabel}`}>
              <span>{next.name}</span>
              <span aria-hidden="true">→</span>
            </Link>
          </nav>
        )}
        <CardSpread systemId={systemId} entryId={entry.id} strip={strip} />
      </PageFrame>
    </div>
  );
}
