import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StatblockList } from "../components/StatblockList";
import { EntryImagesTab } from "../components/EntryImagesTab";
import { MentionsTab } from "../components/MentionsTab";
import { EditableTextCard } from "../components/EditableTextCard";
import { EntityFieldsCard, type EntityField } from "../components/EntityFieldsCard";
import { EntityPage } from "../components/EntityPage";
import { useTabState } from "../hooks/useTabState";
import { useAction, useEntity, useResource, useSaveEntity, write } from "../data/hooks";
import { compendiumAffects, compendiumPaths } from "../data/compendiumEntries";
import { KIND_DEFS, extractEnglishName } from "../compendium";
import type { CompendiumEntry, System, SystemSection } from "../types";
import { useConfirm } from "../hooks/useConfirm";
import { VehiclePlan, VehiclePlanPreview } from "../components/VehiclePlan";

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
  const sectionEntries = useResource<CompendiumEntry[]>(
    isPost ? null : compendiumPaths.sectionEntries(entry.system_id, entry.section_id)
  ).data;
  const posts = (sectionEntries ?? []).filter((e) => e.parent_id === entryId).sort((a, b) => a.position - b.position);
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
  const str = (key: string) => (typeof entry.data[key] === "string" ? (entry.data[key] as string).trim() : "");
  // Под именем — категория и размер метками (гриллинг 2026-10-02, Q7).
  const identTags = [str("category"), str("size")].filter(Boolean);
  // «Справка» — все поля записи; «Править» в шапке раскрывает её.
  const referenceRef = useRef<HTMLDetailsElement>(null);
  function openReference() {
    if (referenceRef.current) {
      referenceRef.current.open = true;
      referenceRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  const fields: EntityField[] = [
    { key: "name", label: "Название", value: entry.name, required: true },
    { key: "name_original", label: "Оригинальное название", value: entry.name_original ?? "" },
    ...(def?.fields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      value: typeof entry.data[f.key] === "string" ? (entry.data[f.key] as string) : "",
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

  const portrait = (
    <button
      type="button"
      className="dossier__portrait"
      title="Сменить картинку — в «Галерее»"
      onClick={() => selectTab("Галерея")}
    >
      {entry.avatar_image_url ? (
        <img src={entry.avatar_image_url} alt={`Картинка: ${entry.name}`} />
      ) : (
        <span className="dossier__portrait-empty">Картинка</span>
      )}
      <span className="dossier__portrait-hint">Сменить в «Галерее»</span>
    </button>
  );

  return (
    <EntityPage
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
      paper
      meta={
        <span className="paper-ident-tags">
          {identTags.map((t) => (
            <span key={t} className="badge tag">
              {t}
            </span>
          ))}
          <span>{def?.label ?? "Транспорт"}</span>
          {ship && (
            <Link className="paper-more" to={`/compendium/${ship.id}`}>
              судна «{ship.name}» ›
            </Link>
          )}
        </span>
      }
      // Удаление разрушительно и потому живёт под «…», а не в шапке.
      // У записи из книги правил его нет вовсе.
      actions={isPost ? [] : [{ label: "Удалить", danger: true, onClick: deleteShip }]}
      tabs={isPost ? POST_TABS : TABS}
      tab={tab}
      onTab={(t) => selectTab(t as (typeof TABS)[number])}
      overlays={confirmDialog}
    >

      {tab === "Досье" && (
        <div className="dossier">
          <aside className="dossier__aside">
            {/* У судна с чертежом на месте портрета — превью чертежа (Q9);
                картинка меняется в «Галерее». */}
            {isPost ? (
              portrait
            ) : (
              <VehiclePlanPreview entryId={entryId} onOpen={() => selectTab("Чертёж")} fallback={portrait} />
            )}
            <dl className="paper-facts">
              {system && (
                <div>
                  <dt className="paper-label">Система</dt>
                  <dd>
                    {system.name}
                    {sectionName ? ` · ${sectionName}` : ""}
                  </dd>
                </div>
              )}
              {entry.name_original && (
                <div>
                  <dt className="paper-label">По-другому</dt>
                  <dd>{entry.name_original}</dd>
                </div>
              )}
            </dl>
          </aside>

          <div className="dossier__main">
            <VehicleHead entry={entry} isPost={isPost} onEdit={openReference} />

            {!isPost && (
              <section className="vehicle-posts">
                <h2 className="paper-group__head">
                  Посты экипажа <span className="paper-group__count">· {posts.length}</span>
                </h2>
                {posts.length > 0 ? (
                  <ul className="paper-rows">
                    {posts.map((p) => (
                      <li key={p.id}>
                        <span className="paper-rows__main">
                          <Link to={`/compendium/${p.id}`}>{p.name || "Без названия"}</Link>
                        </span>
                        <span className="paper-rows__sub">{postStats(p)}</span>
                        <button className="comp-mini" title="Удалить пост" onClick={() => deletePost(p)}>
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Постов экипажа пока нет.</p>
                )}
                <button type="button" className="editable-card-add" onClick={addPost}>
                  + Пост экипажа
                </button>
              </section>
            )}

            <EditableTextCard
              title="Описание"
              value={entry.description}
              onSave={saveDescription}
              rows={6}
              entityType="compendium_entry"
              entityId={entryId}
              collapsible
              defaultOpen
              emptyLabel="описание"
            />

            {/* Справка: все поля записи, стоимость и пассажиры — тут, а не в
                шапке: при покупке, а не в бою (Q7). */}
            <details className="paper-fold" ref={referenceRef}>
              <summary>
                Справка
                {!isPost && str("cost") && <span className="paper-fold__count"> · стоимость {str("cost")}</span>}
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
          </div>
        </div>
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
        <EntryImagesTab
          entryId={entryId}
          entryName={entry.name}
          entryKind={entry.kind}
          avatarUrl={entry.avatar_image_url ?? null}
        />
      )}

      {tab === "Упоминания" && <MentionsTab entityType="compendium_entry" entityId={entryId} />}
    </EntityPage>
  );
}

/** «КЗ 15 · 500» — строка поста: его ломают в бою по одному (Q8). */
function postStats(post: CompendiumEntry): string {
  const ac = typeof post.data.ac === "string" ? post.data.ac.trim() : "";
  const hp = typeof post.data.hp === "string" ? post.data.hp.trim() : "";
  return [ac && `КЗ ${ac}`, hp].filter(Boolean).join(" · ");
}

/**
 * «За столом» судна: то, о чём спрашивают в бою и в пути (гриллинг
 * 2026-10-02, Q7, доска 33). У поста — только его КЗ, прочность и размер.
 */
function VehicleHead({ entry, isPost, onEdit }: { entry: CompendiumEntry; isPost: boolean; onEdit: () => void }) {
  const str = (key: string) => (typeof entry.data[key] === "string" ? (entry.data[key] as string).trim() : "");
  const durability = [str("ac"), str("hp")].filter(Boolean).join(" / ");
  const stats: { label: string; value: string; sub?: string }[] = isPost
    ? [
        { label: "КЗ", value: str("ac") },
        { label: "Прочность", value: str("hp") },
        { label: "Размер", value: str("size") },
      ]
    : [
        { label: "Скорость", value: str("speed") },
        {
          label: "КЗ / прочность",
          value: durability,
          sub: str("damage_threshold") && `порог урона ${str("damage_threshold")}`,
        },
        { label: "Экипаж", value: str("crew") },
        { label: "Груз", value: str("cargo") },
      ];
  const empty = stats.every((st) => !st.value);
  return (
    <article className="creature-card paper-scope creature-card--page is-embedded">
      <div className="creature-card__head">
        <span className="creature-card__head-label">За столом</span>
        <button type="button" className="creature-card__edit" onClick={onEdit}>
          Править
        </button>
      </div>
      {empty ? (
        <div className="creature-card__empty">
          Цифры пока не записаны.{" "}
          <button type="button" className="creature-card__more" onClick={onEdit}>
            Заполнить
          </button>
        </div>
      ) : (
        <dl className="vehicle-head__stats">
          {stats.map((st) => (
            <div key={st.label}>
              <dt className="creature-card__head-label">{st.label}</dt>
              <dd className="vehicle-head__value">{st.value || "—"}</dd>
              {st.sub && <dd className="vehicle-head__sub">{st.sub}</dd>}
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
