import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StatblockList } from "../components/StatblockList";
import { EntryImagesTab } from "../components/EntryImagesTab";
import { MentionsTab } from "../components/MentionsTab";
import { ProfileBlock, ProfileHero, ProfileText } from "../components/profiles/ProfileParts";
import { ProfileFacts, ProfileField } from "../components/profiles/DndProfileParts";
import { entryValue } from "../components/compendiumArticleData";
import { openEntityMenu } from "../pageMenu";
import { EntityFieldsCard, type EntityField } from "../components/EntityFieldsCard";
import { EntityPage } from "../components/EntityPage";
import { useTabState } from "../hooks/useTabState";
import { useAction, useEntity, useResource, useSaveEntity, write } from "../data/hooks";
import { compendiumAffects, compendiumPaths } from "../data/compendiumEntries";
import { KIND_DEFS, extractEnglishName } from "../compendium";
import type { CompendiumEntry, System, SystemSection } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { VehiclePlan, VehiclePlanPreview } from "../components/VehiclePlan";
import "./dnd-profile.css";

// «Галерея» — перед «Упоминаниями», как на странице существа: служебные
// обратные ссылки везде замыкают ряд. Звалась «Изображения» до 2026-09-18.
// «Чертёж» — только у судна (гриллинг профилей 2026-10-02, Q9; тикет 05).
const TABS = ["Досье", "Чертёж", "Статблоки", "Галерея", "Упоминания"] as const;
const POST_TABS = TABS.filter((t) => t !== "Чертёж");

// Страница записи транспорта — судна, повозки или поста экипажа. Записи
// компендиума обычно раскрываются прямо в разделе, но у транспорта, как и у
// существа, есть статблок (у поста экипажа — своя прочность и действия) и
// дети: посты одного судна. В строку раздела это не помещается.
export function VehicleDetailPage({ entry, system }: { entry: CompendiumEntry; system: System | null }) {
  const [confirmDialog, confirm] = useConfirm();
  const entryId = entry.id;
  const navigate = useNavigate();
  const [tab, selectTab] = useTabState(TABS, "Досье", { Статблок: "Статблоки", Изображения: "Галерея" });
  const isPost = entry.kind === "vehicle_post";
  // Судно поста: у поста экипажа своя страница, и без него непонятно, чей он.
  const ship = useEntity<CompendiumEntry>("compendium_entry", isPost ? entry.parent_id : null).data ?? null;
  const sectionEntries = useResource<CompendiumEntry[]>(compendiumPaths.sectionEntries(entry.system_id, entry.section_id)).data;
  const posts = (sectionEntries ?? []).filter((e) => e.parent_id === entryId && e.kind === "vehicle_post").sort((a, b) => a.position - b.position);
  // Раздел в крошках: «Системы / D&D 5.5 / Транспорт / Галеон».
  const sections = useResource<SystemSection[]>(system ? compendiumPaths.sections(system.id) : null).data;
  const sectionName = sections?.find((s) => s.id === entry.section_id)?.name ?? "";
  const { save } = useSaveEntity<CompendiumEntry>("compendium_entry", entryId, { affects: compendiumAffects(entry) });
  const run = useAction();

  // Карточки полей держат правку открытой, пока сохранение не удалось.
  async function saveOrThrow(patch: Partial<CompendiumEntry>) {
    if (!(await save(patch))) throw new Error("Не сохранилось");
  }

  const def = KIND_DEFS[entry.kind];
  const str = (key: string) => entryValue(entry, key);
  // Под именем — категория и размер метками (гриллинг 2026-10-02, Q7).
  const identTags = [str("size"), str("category"), groupDigits(str("cost"))].filter(Boolean);
  const peers = (sectionEntries ?? []).filter((candidate) => candidate.kind === entry.kind && candidate.parent_id === entry.parent_id).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const peerIndex = peers.findIndex((candidate) => candidate.id === entryId);
  const neighbour = (delta: number) => peerIndex >= 0 && peers.length > 1 ? { href: `/compendium/${peers[(peerIndex + delta + peers.length) % peers.length].id}`, name: peers[(peerIndex + delta + peers.length) % peers.length].name } : undefined;
  // «Справка» — все поля записи; «Править» в шапке раскрывает её.
  const referenceRef = useRef<HTMLDetailsElement>(null);
  function openReference() {
    selectTab("Досье");
    requestAnimationFrame(() => {
      if (referenceRef.current) {
        referenceRef.current.open = true;
        referenceRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    });
  }

  const fields: EntityField[] = [
    { key: "name", label: "Название", value: entry.name, required: true },
    { key: "name_original", label: "Оригинальное название", value: entry.name_original ?? "" },
    ...(def?.fields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      value: entryValue(entry, f.key),
      options: f.options
        ? [{ value: "", label: "—" }, ...f.options.map((o) => ({ value: o, label: o }))]
        : undefined,
    })),
  ];

  async function saveSummary(values: Record<string, string>) {
    const data: Record<string, unknown> = { ...entry.data };
    for (const f of def?.fields ?? []) {
      const next = (values[f.key] ?? "").trim();
      if (next) data[f.key] = next;
      else delete data[f.key];
    }
    // «[English]» в конце имени переносится в name_original (см. extractEnglishName):
    const { name, en } = extractEnglishName(values.name.trim());
    await saveOrThrow({
      name,
      name_original: values.name_original.trim() || en,
      data,
    });
  }

  async function saveDescription(value: string) {
    await saveOrThrow({ description: value });
  }

  async function addPost() {
    const created = await run(
      () =>
        write.post<CompendiumEntry>(`/systems/${entry.system_id}/entries`, {
          section_id: entry.section_id,
          parent_id: entryId,
          kind: "vehicle_post",
          name: "",
          level: null,
          data: {},
          description: "",
        }),
      // Без «Повторить»: ответ мог потеряться после записи — повтор завёл бы второй пост.
      { affects: compendiumAffects(entry), retry: false }
    );
    if (!created) return;
    // Пустой пост открывается сразу на своей странице — имя задаётся в «Сводке».
    navigate(`/compendium/${created.id}`);
  }

  async function deletePost(post: CompendiumEntry) {
    if (!(await confirm({ message: `Удалить пост экипажа «${post.name}»?`, confirmLabel: "Удалить", danger: true })))
      return;
    await run(() => write.del(`/systems/entries/${post.id}`), { affects: compendiumAffects(post) });
  }

  async function deleteShip() {
    if (isPost) return;
    const msg =
      posts.length > 0
        ? `Удалить судно «${entry.name}» и все посты экипажа (${posts.length})?`
        : `Удалить судно «${entry.name}»?`;
    if (!(await confirm({ message: msg, confirmLabel: "Удалить", danger: true })))
      return;
    const done = await run(() => write.del(`/systems/entries/${entryId}`).then(() => true), { affects: compendiumAffects(entry) });
    if (done) navigate(`/systems/${entry.system_id}`);
  }

  const portrait = <button type="button" className="profile-cover" onClick={() => selectTab(isPost ? "Галерея" : "Чертёж")} aria-label={isPost ? "Открыть галерею" : "Открыть чертёж"}>
    {entry.avatar_image_url ? <img src={entry.avatar_image_url} alt={entry.name} /> : <span className="dnd-vessel-empty">{isPost ? "Картинка" : "Чертёж"}</span>}
    <span className="profile-cover__caption">{isPost ? "Картинка · открыть галерею" : "Чертёж · открыть вкладку «Чертёж»"}</span>
  </button>;

  return (
    <div className="dnd-vehicle-profile"><EntityPage
      crumbs={[
        { label: "Системы", to: "/systems" },
        ...(system ? [{ label: system.name, to: `/systems/${system.id}` }] : []),
        ...(sectionName && system
          ? [{ label: sectionName, to: `/systems/${system.id}?section=${entry.section_id}` }]
          : []),
        ...(ship ? [{ label: ship.name, to: `/compendium/${ship.id}` }] : []),
        { label: entry.name },
      ]}
      entityType="compendium_entry"
      title={entry.name}
      profile={{ id: entryId, previous: neighbour(-1), next: neighbour(1) }}
      // Удаление разрушительно и потому живёт под «…», а не в шапке.
      // У записи из книги правил его нет вовсе.
      actions={[{ label: "Править", onClick: openReference }, ...(isPost ? [] : [{ label: "Удалить", danger: true, onClick: deleteShip }])]}
      tabs={isPost ? POST_TABS : TABS}
      tab={tab}
      onTab={(t) => selectTab(t as (typeof TABS)[number])}
      overlays={confirmDialog}
    >

      {tab === "Досье" && (
        <>
          <ProfileHero type="compendium_entry" typeLabel={isPost ? "Пост экипажа" : "Транспорт"} name={entry.name} subtype={str("source") || (isPost ? "Пост" : "Судно")} labels={<>{identTags.map((tag) => <span className="gch" key={tag}>{tag}</span>)}{ship && <Link to={`/compendium/${ship.id}`}>судна «{ship.name}» ›</Link>}</>} cover={<div className="dnd-vessel-cover">{isPost ? portrait : <VehiclePlanPreview entryId={entryId} onOpen={() => selectTab("Чертёж")} fallback={portrait} />}</div>}>
            <VehicleHead entry={entry} isPost={isPost} onEdit={openReference} />
          </ProfileHero>

            {!isPost && (
              <ProfileBlock title="Посты экипажа" count={posts.length} actions={<button type="button" className="d-btn d-btn--sm" onClick={addPost}>+ Пост</button>}>
                {posts.length > 0 ? (
                  <ul className="paper-rows">
                    {posts.map((p) => (
                      <li key={p.id}>
                        <span className="paper-rows__main">
                          <Link to={`/compendium/${p.id}`}>{p.name || "Без названия"}</Link>
                        </span>
                        <span className="paper-rows__sub">{postStats(p)}</span>
                        <button type="button" className="d-btn d-btn--sm d-btn--ghost" aria-label={`Действия поста ${p.name}`} onClick={(event) => { const r = event.currentTarget.getBoundingClientRect(); openEntityMenu({ type: "compendium_entry", id: p.id, name: p.name }, r.left, r.bottom, [{ label: "Открыть пост", onClick: () => navigate(`/compendium/${p.id}`) }, { label: "Удалить", danger: true, onClick: () => void deletePost(p) }]); }}>
                          ⋯
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Постов экипажа пока нет.</p>
                )}
              </ProfileBlock>
            )}

            <ProfileText
              title="Описание"
              value={entry.description}
              onSave={saveDescription}
              rows={6}
              emptyLabel={isPost ? "Добавьте описание поста." : "Добавьте описание судна."}
            />

            {/* Справка: все поля записи. Стоимость уже стоит меткой в шапке,
                повтор в заголовке складки убран (приёмка «Д», Ж2). */}
            <details className="paper-fold" ref={referenceRef}>
              <summary>
                Справка
              </summary>
              <div className="paper-fold__body">
                <EntityFieldsCard
                  key={`summary-${entryId}`}
                  title="Сводка"
                  fields={fields}
                  hideEmptyInView
                  onSave={saveSummary}
                />
              </div>
            </details>
        </>
      )}

      {tab === "Чертёж" && !isPost && <VehiclePlan ship={entry} posts={posts} />}

      {tab === "Статблоки" && (
        <StatblockList
          ownerType="compendium_entry"
          ownerId={entryId}
          ownerName={entry.name}
          ownerCreatureSize={(entry.data.size as string | undefined) || undefined}
        />
      )}

      {tab === "Галерея" && (
        <div className="profile-gallery"><EntryImagesTab
          entryId={entryId}
          entryName={entry.name}
          entryKind={entry.kind}
          avatarUrl={entry.avatar_image_url ?? null}
        /></div>
      )}

      {tab === "Упоминания" && <MentionsTab entityType="compendium_entry" entityId={entryId} />}
    </EntityPage></div>
  );
}

/** «КЗ 15 · 500» — строка поста: его ломают в бою по одному (Q8). */
function postStats(post: CompendiumEntry): string {
  const ac = typeof post.data.ac === "string" ? post.data.ac.trim() : "";
  const hp = typeof post.data.hp === "string" ? post.data.hp.trim() : "";
  return [ac && `КЗ ${ac}`, hp].filter(Boolean).join(" · ");
}

/** Только существующие поля судна; пост получает собственную прочность. */
function VehicleHead({ entry, isPost, onEdit }: { entry: CompendiumEntry; isPost: boolean; onEdit: () => void }) {
  const str = (key: string) => entryValue(entry, key);
  const facts = [{ label: "КЗ", value: str("ac") }, { label: "Хиты", value: str("hp") },
    ...(isPost ? [] : [{ label: "Порог урона", value: str("damage_threshold") }, { label: "Скорость", value: str("speed") }])];
  const fields = isPost ? [["size", "Размер"]] : [["crew", "Команда"], ["passengers", "Пассажиры"], ["cargo", "Груз"], ["size", "Размер"]];
  return <ProfileBlock title={isPost ? "Пост" : "Судно"} focal actions={<button type="button" className="d-btn d-btn--sm" onClick={onEdit}>Править</button>}>
    <ProfileFacts facts={facts} />
    <dl className="dnd-profile-fields">{fields.filter(([key]) => str(key)).map(([key, label]) => <ProfileField key={key} label={label}>{str(key)}</ProfileField>)}</dl>
  </ProfileBlock>;
}

/** «40000 зм» → «40 000 зм»: разряды от пяти цифр, как в русском наборе. */
function groupDigits(text: string): string {
  return text.replace(/\d{5,}/g, (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0"));
}
