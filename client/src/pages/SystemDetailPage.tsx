import "./system-d.css";
import { Fragment, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { systemFieldsAffects, systemGroupAffects, systemNameAffects, systemPaths } from "../data/systems";
import { EditableTextCard } from "../components/EditableTextCard";
import { Modal } from "../components/Modal";
import { CompendiumSection } from "../components/CompendiumSection";
import { MonsterSection } from "../components/MonsterSection";
import { VehicleSection } from "../components/VehicleSection";
import { MechanicsSection } from "../components/MechanicsSection";
import { downloadJson } from "../downloadJson";
import { ExportProgress } from "../components/ExportProgress";
import { useImageCrop } from "../hooks/useImageCrop";
import type { Campaign, CompendiumEntry, System, SystemGroup, SystemSection } from "../types";
import { TidyCompendiumDialog } from "../components/TidyCompendiumDialog";
import { EntityPage } from "../components/EntityPage";
import { ContextMenu } from "../components/ContextMenu";
import { LitmGrimoireToc } from "../components/litm/LitmGrimoireView";
import { LitmRulesToc } from "../components/litm/LitmRulesView";
import { LitmSectionSwitch } from "../components/litm/LitmSectionSwitch";
import { litmCatalogOf } from "../components/litm/litmBookText";
import { SectionBackground } from "../components/SectionBackground";
import { EntityImageSlot } from "../components/EntityImageSlot";
import { useAlert, useConfirm } from "../hooks/useConfirm";
import { readOnce } from "../data/imperative";

// У классов и видов в разделе лежат и их умения/черты: в оглавлении считаем
// сами классы и виды, общий итог «с вложенными» остаётся полным.
function topLevelCount(kind: string | undefined, r: { count: number; class_count?: number; species_count?: number }): number {
  return kind === "class" ? r.class_count ?? r.count : kind === "species" ? r.species_count ?? r.count : r.count;
}

function entriesLabel(n: number): string {
  const tail = n % 100;
  const word = tail >= 11 && tail <= 14 ? "записей" : n % 10 === 1 ? "запись" : n % 10 >= 2 && n % 10 <= 4 ? "записи" : "записей";
  return `${n} ${word}`;
}

export function SystemDetailPage() {
  const { id } = useParams();
  const systemId = Number(id);
  const navigate = useNavigate();

  const run = useAction();
  const system = useResource<System>(systemPaths.detail(systemId)).data ?? null;
  const sections = useResource<SystemSection[]>(systemPaths.sections(systemId)).data ?? NO_SECTIONS;
  const campaigns = useResource<Campaign[]>(systemPaths.campaigns(systemId)).data ?? NO_CAMPAIGNS;
  const allGroups = useResource<SystemGroup[]>(systemPaths.groups()).data ?? NO_GROUPS;
  const ofSystem = useResource<SystemGroup[]>(systemPaths.groupsOf(systemId)).data;
  const systemGroupIds = useMemo(() => new Set((ofSystem ?? []).map((g) => g.id)), [ofSystem]);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [tidying, setTidying] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  const [exportImages, setExportImages] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const favourites = useResource<CompendiumEntry[]>(`/systems/${systemId}/entries/favourites`).data;

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("section") ?? "overview";
  const focusEntryId = searchParams.get("entry") ? Number(searchParams.get("entry")) : undefined;
  // Сколько записей в каждом разделе — строка «Классы: 13» в хиро-карточке
  // «Обзора» и счётчики на ярлыках. Считает сервер одним запросом, без
  // вытягивания самих записей.
  const countRows = useResource<{ section_id: number; count: number; class_count?: number; species_count?: number }[]>(
    sections.length > 0 ? systemPaths.entryCounts(systemId) : null
  ).data;
  const sectionCounts = useMemo<Record<number, number>>(
    () => Object.fromEntries((countRows ?? []).map((r) => [r.section_id, topLevelCount(sections.find((s) => s.id === r.section_id)?.kind, r)])),
    [countRows, sections]
  );
  const fieldsAffects = systemFieldsAffects(systemId);

  async function handleThumbnailChange(file: File | null) {
    if (!file) return;
    setUploadingThumbnail(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await run(labelled("Тамбнейл системы", () => write.post(`/systems/${systemId}/thumbnail`, form, { timeoutMs: UPLOAD_TIMEOUT_MS })), {
        affects: fieldsAffects,
      });
    } finally {
      setUploadingThumbnail(false);
    }
  }
  const thumbnailCrop = useImageCrop("thumbnail", handleThumbnailChange);

  async function deleteThumbnail() {
    const ok = await confirm({
      title: "Удалить тамбнейл?",
      message: "Изображение будет удалено с диска.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setUploadingThumbnail(true);
    try {
      await run(labelled("Удаление тамбнейла", () => write.del(`/systems/${systemId}/thumbnail`)), { affects: fieldsAffects });
    } finally {
      setUploadingThumbnail(false);
    }
  }

  if (!system) return <p className="muted">Загрузка…</p>;

  function selectTab(t: string) {
    setSearchParams(t === "overview" ? {} : { section: t });
    setTocOpen(false);
  }

  async function saveName(name: string, code: string) {
    // Двойник кода называется, но не запрещается — см. SettingDetailPage.
    // Карточка сохраняет название вместе с описанием на каждое «Сохранить»;
    // неизменное название не пишется — иначе правка описания перечитывала бы
    // ещё и кампании.
    if (system && name === system.name && code === (system.code ?? "")) return;
    // Отказ бросается дальше: карточка тогда остаётся в правке с набранным.
    const saved = await run(
      labelled("Название системы", () => write.put<{ code_taken_by: string | null }>(`/systems/${systemId}`, { name, code })),
      { affects: systemNameAffects(systemId) }
    );
    if (!saved) throw new Error("Не сохранилось");
    if (saved.code_taken_by) {
      showAlert(`Код «${code}» уже носит «${saved.code_taken_by}». Это разрешено, но в ссылках оба будут выглядеть одинаково.`);
    }
  }

  async function saveDescription(value: string) {
    const saved = await run(
      labelled("Описание системы", () => write.put(`/systems/${systemId}`, { description: value }).then(() => true)),
      { affects: fieldsAffects }
    );
    if (!saved) throw new Error("Не сохранилось");
  }

  async function toggleGroup(groupId: number, isIn: boolean) {
    await run(
      labelled("Группа систем", () =>
        isIn
          ? write.del(`/system-groups/${groupId}/members?systemIds=${systemId}`)
          : write.post(`/system-groups/${groupId}/members`, { systemIds: [systemId] })
      ),
      { affects: systemGroupAffects() }
    );
  }

  async function archiveSystem() {
    const ok = await confirm({
      title: "Архивировать систему?",
      message: `Отправить систему «${system!.name}» в архив?`,
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    const done = await run(labelled("Архивация системы", () => write.del(`/systems/${systemId}`).then(() => true)), {
      affects: [...fieldsAffects, { path: "/archive" }],
    });
    if (done) navigate("/systems");
  }

  async function exportSystem(withImages: boolean) {
    // Сборка выгрузки — один синхронный запрос без процента готовности;
    // с изображениями может идти десятки секунд, поэтому длинный таймаут
    // и бесконечный индикатор, чтобы не выглядело зависшим.
    setExportBusy(true);
    setExportError(null);
    try {
      const data = await readOnce(`/systems/${systemId}/export${withImages ? "?images=1" : ""}`, {
        timeoutMs: 120000,
      });
      downloadJson(data, `system-${system!.name}.json`);
      setExporting(false);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  }

  async function importSystem(file: File) {
    // См. SystemOnboardingModal: большой экспорт едет файлом, не JSON-строкой.
    const form = new FormData();
    form.append("file", file, file.name);
    const created = await run(
      labelled("Импорт системы", () => write.post<System>("/systems/import-file", form, { timeoutMs: 600000 })),
      { affects: [{ path: systemPaths.list() }], retry: false }
    );
    if (!created) return;
    navigate(`/systems/${created.id}`);
  }

  const currentSection = sections.find((s) => String(s.id) === activeTab) ?? null;
  const systemActions = [
    { label: "Привести справочник в порядок", onClick: () => setTidying(true) },
    { label: "Экспорт", onClick: () => setExporting(true) },
    { label: "Импорт", onClick: () => importInputRef.current?.click() },
    { label: "Архивировать", danger: true, onClick: archiveSystem },
  ];
  // Гримуар и Справочник LitM раскрывают своё оглавление под пунктом раздела (доски Litm-Grimoire,
  // Litm-Rules); в шторке телефона его нет — там оглавление в самом разделе.
  const grimToc = (sec: SystemSection) => {
    if (activeTab !== String(sec.id) || searchParams.get("view") === "list") return null;
    const catalog = litmCatalogOf(system.code, sec);
    return catalog === "grimoire" ? <LitmGrimoireToc systemId={systemId} sectionId={sec.id} selectedId={focusEntryId} />
      : catalog === "rules" ? <LitmRulesToc systemId={systemId} sectionId={sec.id} selectedId={focusEntryId} /> : null;
  };
  const tocNav = (withGrim: boolean) => <nav className="sys-toc__items" aria-label="Разделы системы">
    <button type="button" className={activeTab === "overview" ? "active" : ""} aria-current={activeTab === "overview" ? "page" : undefined} onClick={() => selectTab("overview")}>Обзор</button>
    <div className="sys-toc__label d-mono">Разделы · {sections.length}</div>
    {sections.map((sec) => <Fragment key={sec.id}><button type="button" className={activeTab === String(sec.id) ? "active" : ""} aria-current={activeTab === String(sec.id) ? "page" : undefined} onClick={() => selectTab(String(sec.id))}><span>{sec.name}</span>{" "}<b>{sectionCounts[sec.id] ?? "…"}</b></button>{withGrim && grimToc(sec)}</Fragment>)}
  </nav>;
  const toc = tocNav(false);

  return (
    <EntityPage
      crumbs={[{ label: "Системы", to: "/systems" }, { label: system.name, to: currentSection ? `/systems/${systemId}` : undefined }, ...(currentSection ? [{ label: currentSection.name }] : [])]}
      entityType="system"
      title={system.name}
      // «Обзор» стоит в полосе первой вкладкой. Прежде его в полосе не было
      // вовсе: попасть на обзор можно было только щелчком по названию
      // системы — приём, о котором неоткуда узнать.
      systemNavigation={<>
        <aside className="sys-toc"><div className="sys-toc__head"><div className="sys-toc__name">{system.name}</div><div className="row">{system.code && <span className="sys-stamp">{system.code}</span>}<button type="button" className="sys-toc__more" aria-label="Ещё действия" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenuAt({ x: r.left, y: r.bottom }); }}>⋯</button></div></div>{tocNav(true)}</aside>
        <div className="sys-toc-mobile"><button type="button" className="d-btn" aria-haspopup="dialog" onClick={() => setTocOpen(true)}><span>{currentSection?.name ?? "Обзор"}{currentSection ? ` ${sectionCounts[currentSection.id] ?? "…"}` : ""}</span><span>Разделы ▾</span></button></div>
      </>}
      sheet
      tab={activeTab}
      onTab={(t) => selectTab(t)}
      badges={system.code && <span className="sys-stamp">{system.code}</span>}
      // Все четыре действия системы редки — наведение порядка в справочнике,
      // обмен файлами, архивация. Ни одно не заслуживает места в шапке.
      actions={[
        { label: "Привести справочник в порядок", onClick: () => setTidying(true) },
        { label: "Экспорт", onClick: () => setExporting(true) },
        { label: "Импорт", onClick: () => importInputRef.current?.click() },
        { label: "Архивировать", danger: true, onClick: archiveSystem },
      ]}
      overlays={
        <>
          {confirmDialog}
          {alertDialog}
          {menuAt && <ContextMenu {...menuAt} items={systemActions} onClose={() => setMenuAt(null)} />}
          {tocOpen && <Modal ariaLabel="Разделы системы" className="sys-toc-sheet" onClose={() => setTocOpen(false)}><h2>{system.name}</h2>{toc}<button type="button" className="d-btn" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenuAt({ x: r.left, y: r.top }); }}>Действия системы ⋯</button></Modal>}
          <SectionBackground />
          {/* Импорт — файловое поле; пункт меню щёлкает по нему. */}
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importSystem(f);
              // сброс чтобы повторный выбор того же файла снова сработал
              e.currentTarget.value = "";
            }}
          />
        </>
      }
    >
      {activeTab === "overview" && (
        <div className="stack">
          {/* Обзор — макет «Д» Roll-OS-Overview: название на листе (над
              ярлыками его на этой вкладке нет), справки, описание с правкой,
              тамбнейл справа; ниже состав справочника крупными числами. */}
          <section className="sys-hero2">
            <div className="sys-hero2__text">
              <div className="d-mono">Система{system.code ? ` · ${system.code}` : ""}</div>
              {/* каркас в обход намеренно — на «Обзоре» название стоит на листе (макет Roll-OS-Overview), над ярлыками его нет */}
              <h1 className="sys-hero2__title">{system.name}</h1>
              <div className="sys-hero2__desc">
                <EditableTextCard
                  key={`desc-${system.id}`}
                  title="Описание системы"
                  value={system.description}
                  onSave={saveDescription}
                  rows={6}
                  entityType="system"
                  entityId={systemId}
                  fields={[
                    { key: "name", label: "Название системы", value: system.name, required: true },
                    {
                      key: "code",
                      label: "Код",
                      value: system.code ?? "",
                      placeholder: "phb",
                      pattern: "^[a-z0-9-]{2,8}$",
                      title: 'Пример: phb → Player’s Handbook. Короткое сокращение для ссылок [[phb:…]]. Латиница, 2–8 символов.',
                    },
                  ]}
                  onSaveFields={(v) => saveName(v.name, v.code)}
                />
              </div>
              <dl className="sys-hero2__facts"><dt>Код</dt><dd>{system.code ? <>{system.code} — ссылки вида [[{system.code}:…]]</> : "не задан"}</dd><dt>Кампании</dt><dd>{campaigns.length || "пока нет"}</dd></dl>
            </div>
            <div className="sys-hero2__thumb">
              <div className="entity-image-slots">
                <EntityImageSlot
                  title="Тамбнейл системы"
                  hint="Карточка в списке систем. Рекомендуем 900×562 (16×10), до 15 MB, JPG/PNG/GIF/WebP/AVIF."
                  url={system.thumbnail_image_url}
                  uploading={uploadingThumbnail}
                  onSelect={thumbnailCrop.onSelect}
                  onDelete={system.thumbnail_image_url ? deleteThumbnail : undefined}
                />
              </div>
              {thumbnailCrop.modal}
            </div>
          </section>
          <section><div className="d-plate-row"><h2 className="d-plate">Частые обращения</h2></div>
            {favourites?.length ? <div className="sys-favourites">{favourites.map((entry) => <Link key={entry.id} to={["class", "subclass", "species"].includes(entry.kind) ? `/systems/${systemId}/entries/${entry.id}` : ["monster", "vehicle", "vehicle_post"].includes(entry.kind) ? `/compendium/${entry.id}` : `/systems/${systemId}?section=${entry.section_id}&entry=${entry.id}`}><span>{entry.name}</span></Link>)}</div> : <p className="muted">{favourites ? "Отметьте ★ записи, к которым обращаетесь чаще всего, — они встанут сюда" : "Загружаю избранное…"}</p>}
          </section>
          <section>
            <div className="d-plate-row">
              <h2 className="d-plate">Состав справочника</h2>
              <span className="d-note">{entriesLabel((countRows ?? []).reduce((sum, r) => sum + r.count, 0))} с вложенными</span>
            </div>
            {sections.length === 0 ? (
              <span className="muted">Разделов пока нет.</span>
            ) : (
              <div className="sys-counts">
                {sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={`Перейти в раздел «${s.name}»`}
                    onClick={() => selectTab(String(s.id))}
                  >
                    <b>{sectionCounts[s.id] ?? "…"}</b>
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section>
            <div className="d-plate-row">
              <h2 className="d-plate">Группы</h2>
            </div>
            {allGroups.length > 0 ? (
              <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                {allGroups.map((g) => {
                  const isIn = systemGroupIds.has(g.id);
                  return (
                    <label key={g.id} className={`campaign-group-chip${isIn ? " selected" : ""}`}>
                      <input
                        type="checkbox"
                        checked={isIn}
                        onChange={() => void toggleGroup(g.id, isIn)}
                      />
                      {g.name}
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="muted">Групп пока нет — создайте на странице систем.</div>
            )}
          </section>
            {/* Визард ссылок для системы скрыт до тех пор, пока в нём не появится
                нужда: у систем нет прозы, которую стоило бы прочёсывать, и кнопка
                обещала искать «в текстах системы», а сканировать нечего. Код оставлен
                по решению владельца 2026-08-29 (бывший `ToDo.md` П1.10). */}
            {/* <CrossLinksWizard
               ownerKind="system"
               ownerId={systemId}
               help="Ищет имена сущностей сеттинга и записей компендиума в текстах системы — и делает их кликабельными. Шаг за шагом, по одному типу цели. Ничего не пишет, пока вы не подтвердите."
             /> */}
          {campaigns.length > 0 && (
            <section>
              <div className="d-plate-row">
                <h2 className="d-plate">Кампании с этой системой</h2>
                <span className="d-note">{campaigns.length}</span>
              </div>
              <div className="grid-cards">
                {campaigns.map((c) => (
                  <Link key={c.id} to={`/campaigns/${c.id}`} className="card">
                    <h3>{c.name}</h3>
                    <div className="sys-card-meta">{c.setting_name ?? "Сеттинг не указан"}</div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab !== "overview" &&
        (currentSection ? (
          <LitmSectionSwitch systemCode={system.code} systemId={systemId} section={currentSection} focusEntryId={focusEntryId}>
          {currentSection.kind === "monster" ? (
            <MonsterSection
              key={currentSection.id}
              systemId={systemId}
              section={currentSection}
            />
          ) : currentSection.kind === "vehicle" ? (
            <VehicleSection
              key={currentSection.id}
              systemId={systemId}
              section={currentSection}
            />
          ) : currentSection.kind === "mechanics" ? (
            <MechanicsSection
              key={currentSection.id}
              systemId={systemId}
              section={currentSection}
              focusEntryId={focusEntryId}
            />
          ) : (
            <CompendiumSection
              key={currentSection.id}
              systemId={systemId}
              section={currentSection}
              focusEntryId={focusEntryId}
            />
          )}
          </LitmSectionSwitch>
        ) : (
          <p className="muted">Раздел не найден.</p>
        ))}

      {tidying && (
        <TidyCompendiumDialog
          systemId={systemId}
          onClose={() => {
            // Всю систему перечитывает сам диалог сразу после уборки.
            setTidying(false);
          }}
        />
      )}

      {exporting && (
        <Modal onClose={() => { if (!exportBusy) { setExporting(false); setExportError(null); } }}>
          <h3>Экспорт системы</h3>
          <label className="row" style={{ cursor: exportBusy ? "default" : "pointer", gap: 4 }}>
            <input type="checkbox" checked={exportImages} disabled={exportBusy} onChange={(e) => setExportImages(e.target.checked)} />
            <span className="muted">с изображениями</span>
          </label>
          {exportBusy && <ExportProgress label="Идёт экспорт…" />}
          {exportError && !exportBusy && <ExportProgress error={exportError} />}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={exportBusy} onClick={() => exportSystem(exportImages)}>
              {exportBusy ? "Экспортируем…" : "Экспорт"}
            </button>
            <button disabled={exportBusy} onClick={() => { setExporting(false); setExportError(null); }}>Отмена</button>
          </div>
        </Modal>
      )}
    </EntityPage>
  );
}

const UPLOAD_TIMEOUT_MS = 120_000;
const NO_SECTIONS: SystemSection[] = [];
const NO_CAMPAIGNS: Campaign[] = [];
const NO_GROUPS: SystemGroup[] = [];
