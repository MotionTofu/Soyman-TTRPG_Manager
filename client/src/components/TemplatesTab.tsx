import { useEffect, useState } from "react";
import { api } from "../api/client";
import { emptyChallenge, LitMChallengeEdit, LitMChallengeView } from "./litm/LitMChallengeForm";
import { emptyCreature, normalizeDndCreature, DndCreatureView } from "./dnd/DndCreatureForm";
import { MentionText } from "./mentions/MentionText";
import type { DndCreatureData, LitMChallengeData, Resource, StatblockFormat } from "../types";

const TEMPLATE_TYPE = "statblock_template";
const TEMPLATE_FORMAT_LABELS: Record<StatblockFormat, string> = {
  text: "Обычный текст",
  litm_character: "Legend in the Mist — Персонаж",
  litm_challenge: "Legend in the Mist — Угроза (Challenge)",
  dnd_character: "D&D — Персонаж",
  dnd_creature: "D&D — Существо",
};

interface Props {
  // Pass a system id to scope this tab to that system's templates (used on
  // SystemDetailPage); omit to show only unscoped/global templates (used on
  // the global Ресурсы page's "Шаблоны" section).
  systemId?: number;
}

// Shared by ResourcesListPage ("Общие шаблоны", systemId omitted) and
// SystemDetailPage ("Шаблоны" tab, systemId set) — same create+list UI,
// just scoped to a different system_id filter.
export function TemplatesTab({ systemId }: Props) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateKind, setTemplateKind] = useState<"short" | "full">("full");
  const [templateContent, setTemplateContent] = useState("");
  const [templateFormat, setTemplateFormat] = useState<StatblockFormat>("text");
  const [challengeDraft, setChallengeDraft] = useState<LitMChallengeData>(emptyChallenge());
  const [creatureDraft, setCreatureDraft] = useState<DndCreatureData>(emptyCreature());

  function refresh() {
    const params = new URLSearchParams({ scope: "global", type: TEMPLATE_TYPE });
    if (systemId) params.set("system_id", String(systemId));
    api.get<Resource[]>(`/resources?${params.toString()}`).then((all) =>
      setResources(systemId ? all : all.filter((r) => !r.system_id))
    );
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [systemId]);

  function resetForm() {
    setEditingId(null);
    setTemplateName("");
    setTemplateContent("");
    setTemplateFormat("text");
    setTemplateKind("full");
    setChallengeDraft(emptyChallenge());
    setCreatureDraft(emptyCreature());
  }

  function startEdit(r: Resource) {
    setEditingId(r.id);
    setTemplateName(r.name);
    const format = (r.template_format as StatblockFormat | undefined) || "text";
    setTemplateFormat(format);
    setTemplateKind((r.template_kind as "short" | "full") || "full");
    if (format === "litm_challenge") {
      setChallengeDraft({ ...emptyChallenge(), ...JSON.parse(r.notes || "{}") });
    } else if (format === "dnd_creature") {
      setCreatureDraft(normalizeDndCreature(JSON.parse(r.notes || "{}")));
    } else {
      setTemplateContent(r.notes || "");
    }
  }

  async function saveTemplate() {
    if (!templateName.trim()) return;
    if (editingId != null) {
      const notes =
        templateFormat === "litm_challenge"
          ? JSON.stringify(challengeDraft)
          : templateFormat === "dnd_creature"
          ? JSON.stringify(creatureDraft)
          : templateContent;
      await api.put(`/resources/${editingId}`, {
        name: templateName,
        template_format: templateFormat,
        template_kind: templateFormat === "text" ? templateKind : "full",
        notes,
      });
    } else {
      const form = new FormData();
      form.append("name", templateName);
      form.append("scope", "global");
      form.append("type", TEMPLATE_TYPE);
      form.append("template_format", templateFormat);
      if (templateFormat === "litm_challenge") {
        form.append("template_kind", "full");
        form.append("notes", JSON.stringify(challengeDraft));
      } else if (templateFormat === "dnd_creature") {
        form.append("template_kind", "full");
        form.append("notes", JSON.stringify(creatureDraft));
      } else {
        form.append("template_kind", templateKind);
        form.append("notes", templateContent);
      }
      if (systemId) form.append("system_id", String(systemId));
      await api.post("/resources", form);
    }
    resetForm();
    refresh();
  }

  async function archiveResource(id: number) {
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
    await api.del(`/resources/${id}`);
    if (editingId === id) resetForm();
    refresh();
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row">
          <input
            placeholder="Название шаблона"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
          />
          <select
            value={templateFormat}
            onChange={(e) => setTemplateFormat(e.target.value as StatblockFormat)}
          >
            <option value="text">{TEMPLATE_FORMAT_LABELS.text}</option>
            <option value="litm_challenge">{TEMPLATE_FORMAT_LABELS.litm_challenge}</option>
            <option value="dnd_creature">{TEMPLATE_FORMAT_LABELS.dnd_creature}</option>
          </select>
          {templateFormat === "text" && (
            <select
              value={templateKind}
              onChange={(e) => setTemplateKind(e.target.value as "short" | "full")}
            >
              <option value="short">Краткий</option>
              <option value="full">Полный</option>
            </select>
          )}
        </div>
        {templateFormat === "text" ? (
          <textarea
            rows={6}
            placeholder="Текст шаблона (можно использовать плейсхолдеры вроде HP: ..., AC: ...)"
            value={templateContent}
            onChange={(e) => setTemplateContent(e.target.value)}
          />
        ) : templateFormat === "litm_challenge" ? (
          <LitMChallengeEdit value={challengeDraft} onChange={setChallengeDraft} />
        ) : (
          <DndCreatureView value={creatureDraft} onQuickUpdate={(p) => setCreatureDraft({ ...creatureDraft, ...p })} />
        )}
        <div className="row">
          <button className="primary" onClick={saveTemplate} style={{ alignSelf: "flex-start" }}>
            {editingId != null ? "Сохранить шаблон" : "Добавить шаблон"}
          </button>
          {editingId != null && <button onClick={resetForm}>Отмена</button>}
        </div>
      </div>

      <div className="grid-cards">
        {resources.map((r) => (
          <div key={r.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3>{r.name}</h3>
              <span className="row" style={{ gap: 4 }}>
                <button className="comp-mini" onClick={() => startEdit(r)}>
                  ✎
                </button>
                <button className="comp-mini danger" onClick={() => archiveResource(r.id)}>
                  ✕
                </button>
              </span>
            </div>
            <div className="row">
              {!systemId && r.system_name && <span className="badge tag">{r.system_name}</span>}
              {(!r.template_format || r.template_format === "text") && (
                <span className="badge tag">{r.template_kind === "short" ? "краткий" : "полный"}</span>
              )}
              {r.template_format === "litm_challenge" && (
                <span className="badge tag">{TEMPLATE_FORMAT_LABELS.litm_challenge}</span>
              )}
              {r.template_format === "dnd_creature" && (
                <span className="badge tag">{TEMPLATE_FORMAT_LABELS.dnd_creature}</span>
              )}
            </div>
            {r.template_format === "litm_challenge" ? (
              <LitMChallengeView value={JSON.parse(r.notes || "{}")} />
            ) : r.template_format === "dnd_creature" ? (
              <DndCreatureView value={normalizeDndCreature(JSON.parse(r.notes || "{}"))} />
            ) : (
              <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={r.notes} />
              </p>
            )}
          </div>
        ))}
        {resources.length === 0 && <p className="muted">Шаблонов пока нет.</p>}
      </div>
    </div>
  );
}
