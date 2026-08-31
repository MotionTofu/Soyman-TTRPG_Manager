import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { EditableTextCard } from "../components/EditableTextCard";
import { Modal } from "../components/Modal";
import { CompendiumSection } from "../components/CompendiumSection";
import { MonsterSection } from "../components/MonsterSection";
import { VehicleSection } from "../components/VehicleSection";
import { downloadJson } from "../downloadJson";
import { useImageCrop } from "../hooks/useImageCrop";
import type { Campaign, System, SystemGroup, SystemSection } from "../types";
import { NavIcon } from "../components/NavIcons";
import { TidyCompendiumDialog } from "../components/TidyCompendiumDialog";
import { EntityImageSlot } from "../components/EntityImageSlot";
import { useAlert, useConfirm } from "../hooks/useConfirm";

export function SystemDetailPage() {
  const { id } = useParams();
  const systemId = Number(id);
  const navigate = useNavigate();

  const [system, setSystem] = useState<System | null>(null);
  const [sections, setSections] = useState<SystemSection[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [allGroups, setAllGroups] = useState<SystemGroup[]>([]);
  const [systemGroupIds, setSystemGroupIds] = useState<Set<number>>(new Set());
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  // Уборка справочника правит записи мимо экрана: раздел читает их один раз
  // при монтировании и о правке не узнаёт, поэтому после неё показывал старое
  // — пустые поля и фильтр, которому не по чему фильтровать. Ключ раздела
  // меняется, раздел перечитывает записи.
  const [tidyRun, setTidyRun] = useState(0);
  const [exportImages, setExportImages] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("section") ?? "overview";
  const focusEntryId = searchParams.get("entry") ? Number(searchParams.get("entry")) : undefined;

  function refreshSystem() {
    api.get<System>(`/systems/${systemId}`).then(setSystem);
  }
  function refreshSections() {
    api.get<SystemSection[]>(`/systems/${systemId}/sections`).then(setSections);
  }
  async function refreshGroups() {
    const [all, mine] = await Promise.all([
      api.get<SystemGroup[]>("/system-groups"),
      api.get<SystemGroup[]>(`/system-groups/by-system/${systemId}`),
    ]);
    setAllGroups(all);
    setSystemGroupIds(new Set(mine.map((g) => g.id)));
  }
  useEffect(() => {
    refreshSystem();
    refreshSections();
    refreshGroups();
    api.get<Campaign[]>(`/campaigns?system_id=${systemId}`).then(setCampaigns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  async function handleThumbnailChange(file: File | null) {
    if (!file) return;
    setUploadingThumbnail(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/systems/${systemId}/thumbnail`, form);
      // Форс-обновление без кэша — иначе F5 нужен, т.к. ?v= может совпасть в пределах секунды
      const updated = await api.get<System>(`/systems/${systemId}?t=${Date.now()}`);
      setSystem(updated);
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
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
      await api.del(`/systems/${systemId}/thumbnail`);
      const updated = await api.get<System>(`/systems/${systemId}?t=${Date.now()}`);
      setSystem(updated);
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
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
    const saved = await api.put<{ code_taken_by: string | null }>(`/systems/${systemId}`, {
      name,
      code,
    });
    if (saved.code_taken_by) {
      showAlert(`Код «${code}» уже носит «${saved.code_taken_by}». Это разрешено, но в ссылках оба будут выглядеть одинаково.`);
    }
    refreshSystem();
  }

  async function saveDescription(value: string) {
    await api.put(`/systems/${systemId}`, { description: value });
    refreshSystem();
  }

  async function archiveSystem() {
    const ok = await confirm({
      title: "Архивировать систему?",
      message: "Отправить систему в архив?",
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/systems/${systemId}`);
      navigate("/systems");
    } catch (e) {
      showAlert(`Не удалось архивировать: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function exportSystem(withImages: boolean) {
    const data = await api.get(`/systems/${systemId}/export${withImages ? "?images=1" : ""}`);
    downloadJson(data, `system-${system!.name}.json`);
    setExporting(false);
  }

  async function importSystem(file: File) {
    const data = JSON.parse(await file.text());
    const created = await api.post<System>("/systems/import", data);
    navigate(`/systems/${created.id}`);
  }

  const currentSection = sections.find((s) => String(s.id) === activeTab) ?? null;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>
          <button type="button" className="entity-title-link" onClick={() => selectTab("overview")} title="К обзору">
            {system.name}
          </button>
          {system.code && <span className="sys-stamp">{system.code}</span>}
        </h1>
        <div className="entity-header-actions">
          {/* Название правится в карточке «Описание системы» на обзоре. */}
          <button onClick={() => navigate(`/import-system?system=${systemId}`)}>
            Импорт книги правил
          </button>
          {/* Соседство с импортом не случайно: чаще всего порядок наводят
              сразу после того, как книга разложилась по разделам. */}
          <button onClick={() => setTidying(true)}>Привести справочник в порядок</button>
          <button className="danger" onClick={archiveSystem}>
            <NavIcon name="archive" /> Архивировать
          </button>
        </div>
      </div>

      <div className="row sys-tabs" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div className="tabs" style={{ flexWrap: "wrap" }}>
          {sections.map((s) => (
            <button
              key={s.id}
              className={String(s.id) === activeTab ? "active" : ""}
              onClick={() => selectTab(String(s.id))}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="row">
          <button onClick={() => setExporting(true)}>Экспорт</button>
          <label className="row" style={{ cursor: "pointer" }}>
            Импорт
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && importSystem(e.target.files[0])}
            />
          </label>
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="stack">
          {confirmDialog}
          {alertDialog}
          <section className="sys-card">
            <div className="sys-card-head">Тамбнейл — 16×10</div>
            <div className="sys-card-body">
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
          <EditableTextCard
            key={`desc-${system.id}`}
            title="Описание системы"
            help="Что за система, ключевые механики, чем отличается от других."
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
           {/* Визард ссылок для системы скрыт до тех пор, пока в нём не появится
               нужда: у систем нет прозы, которую стоило бы прочёсывать, и кнопка
               обещала искать «в текстах системы», а сканировать нечего. Код оставлен
               по решению владельца — см. ToDo.md П1.10. */}
           {/* <CrossLinksWizard
              ownerKind="system"
              ownerId={systemId}
              help="Ищет имена сущностей сеттинга и записей компендиума в текстах системы — и делает их кликабельными. Шаг за шагом, по одному типу цели. Ничего не пишет, пока вы не подтвердите."
            /> */}
            <div className="card">
              <div className="campaign-overview-header">Группы</div>
              <div style={{ padding: "8px 0" }}>
                {allGroups.length > 0 ? (
                  <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                    {allGroups.map((g) => {
                      const isIn = systemGroupIds.has(g.id);
                      return (
                        <label key={g.id} className={`campaign-group-chip${isIn ? " selected" : ""}`}>
                          <input
                            type="checkbox"
                            checked={isIn}
                            onChange={async () => {
                              if (isIn) {
                                await api.del(`/system-groups/${g.id}/members?systemIds=${systemId}`);
                              } else {
                                await api.post(`/system-groups/${g.id}/members`, { systemIds: [systemId] });
                              }
                              refreshGroups();
                            }}
                          />
                          {g.name}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: 4 }}>Групп пока нет — создайте на странице систем.</div>
                )}
              </div>
            </div>
            <details className="sys-card">
             <summary className="sys-card-head">Кампании с этой системой ({campaigns.length})</summary>
            <div className="sys-card-body">
              <div className="grid-cards">
                {campaigns.map((c) => (
                  <Link key={c.id} to={`/campaigns/${c.id}`} className="card">
                    <h3>{c.name}</h3>
                    <div className="muted">{c.setting_name ?? "Сеттинг не указан"}</div>
                  </Link>
                ))}
                {campaigns.length === 0 && <p className="muted">Пока нет кампаний с этой системой.</p>}
              </div>
            </div>
          </details>
        </div>
      )}

      {activeTab !== "overview" &&
        (currentSection ? (
          currentSection.kind === "monster" ? (
            <MonsterSection
              key={`${currentSection.id}-${tidyRun}`}
              systemId={systemId}
              section={currentSection}
            />
          ) : currentSection.kind === "vehicle" ? (
            <VehicleSection
              key={`${currentSection.id}-${tidyRun}`}
              systemId={systemId}
              section={currentSection}
            />
          ) : (
            <CompendiumSection
              key={`${currentSection.id}-${tidyRun}`}
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
            setTidying(false);
            refreshSections();
            setTidyRun((n) => n + 1);
          }}
        />
      )}

      {exporting && (
        <Modal onClose={() => setExporting(false)}>
          <h3>Экспорт системы</h3>
          <label className="row" style={{ cursor: "pointer", gap: 4 }}>
            <input type="checkbox" checked={exportImages} onChange={(e) => setExportImages(e.target.checked)} />
            <span className="muted">с изображениями</span>
          </label>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => exportSystem(exportImages)}>
              Экспорт
            </button>
            <button onClick={() => setExporting(false)}>Отмена</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
