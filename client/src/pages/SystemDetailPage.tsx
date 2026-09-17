import { useMemo, useRef, useState } from "react";
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
import type { Campaign, System, SystemGroup, SystemSection } from "../types";
import { NavIcon } from "../components/NavIcons";
import { TidyCompendiumDialog } from "../components/TidyCompendiumDialog";
import { EntityPage } from "../components/EntityPage";
import { SectionBackground } from "../components/SectionBackground";
import { EntityImageSlot } from "../components/EntityImageSlot";
import { useAlert, useConfirm } from "../hooks/useConfirm";
import { readOnce } from "../data/imperative";

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

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("section") ?? "overview";
  const focusEntryId = searchParams.get("entry") ? Number(searchParams.get("entry")) : undefined;
  // Сколько записей в каждом разделе — строка «Классы: 13» в хиро-карточке
  // «Обзора». Считает сервер одним запросом, без вытягивания самих записей.
  const countRows = useResource<{ section_id: number; count: number }[]>(
    activeTab === "overview" && sections.length > 0 ? systemPaths.entryCounts(systemId) : null
  ).data;
  const sectionCounts = useMemo<Record<number, number>>(
    () => Object.fromEntries((countRows ?? []).map((r) => [r.section_id, r.count])),
    [countRows]
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
      message: "Отправить систему в архив?",
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

  return (
    <EntityPage
      crumbs={[{ label: "Системы", to: "/systems" }, { label: system.name }]}
      entityType="system"
      title={system.name}
      // «Обзор» стоит в полосе первой вкладкой. Прежде его в полосе не было
      // вовсе: попасть на обзор можно было только щелчком по названию
      // системы — приём, о котором неоткуда узнать.
      tabs={[{ id: "overview", label: "Обзор" }, ...sections.map((sec) => ({ id: String(sec.id), label: sec.name }))]}
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
          {confirmDialog}
          {alertDialog}
          <section className="sys-hero">
            <div className="sys-hero-body">
              <div className="sys-hero-thumb">
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
              <div className="sys-hero-main stack">
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
                <div className="sys-hero-meta">
                  <span className="sys-hero-meta-label">Состав справочника</span>
                  {sections.length === 0 ? (
                    <span className="muted">Разделов пока нет.</span>
                  ) : (
                    <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                      {sections.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="sys-hero-count"
                          title={`Перейти в раздел «${s.name}»`}
                          onClick={() => selectTab(String(s.id))}
                        >
                          {s.name}: {sectionCounts[s.id] ?? "…"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="sys-hero-meta">
                  <span className="sys-hero-meta-label">Группы</span>
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
                </div>
              </div>
            </div>
          </section>
            {/* Визард ссылок для системы скрыт до тех пор, пока в нём не появится
                нужда: у систем нет прозы, которую стоило бы прочёсывать, и кнопка
                обещала искать «в текстах системы», а сканировать нечего. Код оставлен
                по решению владельца — см. ToDo.md П1.10. */}
            {/* <CrossLinksWizard
               ownerKind="system"
               ownerId={systemId}
               help="Ищет имена сущностей сеттинга и записей компендиума в текстах системы — и делает их кликабельными. Шаг за шагом, по одному типу цели. Ничего не пишет, пока вы не подтвердите."
             /> */}
            <section>
             <div className="sys-card-head">Кампании с этой системой ({campaigns.length})</div>
            <div className="sys-campaigns-body">
              <div className="grid-cards">
                {campaigns.map((c) => (
                  <Link key={c.id} to={`/campaigns/${c.id}`} className="card">
                    <h3>{c.name}</h3>
                    <div className="sys-card-meta">{c.setting_name ?? "Сеттинг не указан"}</div>
                  </Link>
                ))}
                {campaigns.length === 0 && <p className="muted">Пока нет кампаний с этой системой.</p>}
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab !== "overview" &&
        (currentSection ? (
          currentSection.kind === "monster" ? (
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
          )
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
