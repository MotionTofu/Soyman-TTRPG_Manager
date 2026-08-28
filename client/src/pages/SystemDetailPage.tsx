import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { EditableTextCard } from "../components/EditableTextCard";
import { Modal } from "../components/Modal";
import { CompendiumSection } from "../components/CompendiumSection";
import { downloadJson } from "../downloadJson";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { useImageCrop } from "../hooks/useImageCrop";
import type { Campaign, System, SystemSection } from "../types";
import { NavIcon } from "../components/NavIcons";
import { TidyCompendiumDialog } from "../components/TidyCompendiumDialog";

export function SystemDetailPage() {
  const { id } = useParams();
  const systemId = Number(id);
  const navigate = useNavigate();

  const [system, setSystem] = useState<System | null>(null);
  const [sections, setSections] = useState<SystemSection[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tidying, setTidying] = useState(false);
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
  useEffect(() => {
    refreshSystem();
    refreshSections();
    api.get<Campaign[]>(`/campaigns?system_id=${systemId}`).then(setCampaigns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  async function handleThumbnailChange(file: File | null) {
    if (!file) return;
    setUploadingThumbnail(true);
    const form = new FormData();
    form.append("file", file);
    await api.post(`/systems/${systemId}/thumbnail`, form);
    setUploadingThumbnail(false);
    refreshSystem();
  }
  const thumbnailCrop = useImageCrop("thumbnail", handleThumbnailChange);

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
      alert(`Код «${code}» уже носит «${saved.code_taken_by}». Это разрешено, но в ссылках оба будут выглядеть одинаково.`);
    }
    refreshSystem();
  }

  async function saveDescription(value: string) {
    await api.put(`/systems/${systemId}`, { description: value });
    refreshSystem();
  }

  async function archiveSystem() {
    if (!confirm("Отправить систему в архив?")) return;
    await api.del(`/systems/${systemId}`);
    navigate("/systems");
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
          <section className="sys-card">
            <div className="sys-card-head">Тамбнейл</div>
            <div className="sys-card-body">
              {system.thumbnail_image_url && (
                <img src={system.thumbnail_image_url} alt="" />
              )}
              <label>
                {uploadingThumbnail ? "Загрузка…" : "Выбрать изображение"}
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  style={{ display: "none" }}
                  onChange={(e) => thumbnailCrop.onSelect(e.target.files?.[0] ?? null)}
                />
              </label>
              {thumbnailCrop.modal}
              <span className="muted image-hint">{IMAGE_HINT}</span>
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
                title: 'Короткое сокращение модуля — «phb», «dh». Подставляется в ссылки внутри текстов вместо полного имени: токен Мастер видит при каждой правке, и короткий читается заметно легче. Его же увидит тот, у кого этого модуля нет.',
              },
            ]}
            onSaveFields={(v) => saveName(v.name, v.code)}
          />
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
          <CompendiumSection
            key={`${currentSection.id}-${tidyRun}`}
            systemId={systemId}
            section={currentSection}
            focusEntryId={focusEntryId}
          />
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
