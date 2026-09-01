import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useConfirm } from "../hooks/useConfirm";
import { Modal } from "./Modal";
import { formatImportantDate, formatCustomRule } from "../inworldCalendar";
import type { CalendarMonth, CalendarWeekday, CustomRule, ImportantDate, SettingCalendar } from "../types";

interface OwnerOption { type: "being" | "community" | "location"; id: number; name: string; }
interface DateTypeSuggestion { date_type: string; color: string; }

interface Draft {
  title: string;
  description: string;
  date_type: string;
  color: string;
  recurrence: "annual" | "monthly" | "weekly" | "custom";
  year: string;
  month: string;
  day: string;
  custom_rule: CustomRule;
  owner_type: "being" | "community" | "location" | "setting" | "";
  owner_id: number | null;
}

const EMPTY_DRAFT: Draft = {
  title: "", description: "", date_type: "", color: "",
  recurrence: "annual", year: "", month: "", day: "1",
  custom_rule: { kind: "every", every_n: 1, every_unit: "год" },
  owner_type: "", owner_id: null,
};

const MONTH_NAMES = [
  { value: 1, label: "Январь" }, { value: 2, label: "Февраль" }, { value: 3, label: "Март" },
  { value: 4, label: "Апрель" }, { value: 5, label: "Май" }, { value: 6, label: "Июнь" },
  { value: 7, label: "Июль" }, { value: 8, label: "Август" }, { value: 9, label: "Сентябрь" },
  { value: 10, label: "Октябрь" }, { value: 11, label: "Ноябрь" }, { value: 12, label: "Декабрь" },
];

const CUSTOM_UNITS = ["день", "неделя", "месяц", "год", "десятилетие", "столетие", "тысячелетие"];

const GROUP_LABELS: Record<string, string> = {
  annual: "Ежегодные",
  monthly: "Ежемесячные",
  weekly: "Еженедельные",
  custom: "Особые",
};

const OWNER_LABELS: Record<string, string> = {
  being: "Личность",
  community: "Фракция",
  location: "Локация",
};

function sortChronological(a: ImportantDate, b: ImportantDate): number {
  const ma = a.month ?? 0, mb = b.month ?? 0;
  if (ma !== mb) return ma - mb;
  return a.day - b.day;
}

function everyPreview(n: number, unit: string): string {
  if (n === 1) return unit;
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return `${n} ${unit}ов`;
  if (last === 1) return `${n} ${unit}`;
  if (last >= 2 && last <= 4) return `${n} ${unit}а`;
  return `${n} ${unit}ов`;
}

function ordinalPreview(n: number, unit1: string, unit2: string): string {
  const unit2Gen = unit2 === "месяц" ? "месяца" : unit2 === "год" ? "года" : unit2;
  return `${n}-й ${unit1} ${unit2Gen}`;
}

export function ImportantDatesSection({ settingId, months = [], weekdays: weekdaysProp }: { settingId: number; months?: CalendarMonth[]; weekdays?: CalendarWeekday[] }) {
  const [dates, setDates] = useState<ImportantDate[]>([]);
  const [owners, setOwners] = useState<{ beings: OwnerOption[]; communities: OwnerOption[]; locations: OwnerOption[] }>({ beings: [], communities: [], locations: [] });
  const [dateTypes, setDateTypes] = useState<DateTypeSuggestion[]>([]);
  const [weekdays, setWeekdays] = useState<CalendarWeekday[]>(weekdaysProp ?? []);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fetchedMonths, setFetchedMonths] = useState<CalendarMonth[]>([]);

  const refresh = useCallback(() => {
    const ac = new AbortController();
    api.get<ImportantDate[]>(`/settings/${settingId}/important-dates`, { signal: ac.signal })
      .then(setDates).catch(() => {});
    return () => ac.abort();
  }, [settingId]);

  useEffect(() => { const cleanup = refresh(); return cleanup; }, [refresh]);

  useEffect(() => {
    api.get<{ beings: OwnerOption[]; communities: OwnerOption[]; locations: OwnerOption[] }>(`/settings/${settingId}/entities`)
      .then(setOwners).catch(() => {});
    api.get<DateTypeSuggestion[]>(`/settings/${settingId}/date-types`)
      .then(setDateTypes).catch(() => {});
    if (!weekdaysProp || weekdaysProp.length === 0) {
      api.get<SettingCalendar>(`/settings/${settingId}/calendar`)
        .then((c) => setWeekdays(c.weekdays ?? [])).catch(() => {});
    } else {
      setWeekdays(weekdaysProp);
    }
    if (months.length === 0) {
      api.get<SettingCalendar>(`/settings/${settingId}/calendar`)
        .then((c) => setFetchedMonths(c.months ?? [])).catch(() => {});
    }
  }, [settingId, weekdaysProp, months]);

  const effectiveMonths = months.length > 0 ? months : fetchedMonths;
  const weekdaysList = useMemo(() => weekdays.map((w) => w.name), [weekdays]);

  const typeSuggestions = useMemo(() => {
    const q = draft.date_type.trim().toLowerCase();
    if (!q) return dateTypes;
    return dateTypes.filter((t) => t.date_type.toLowerCase().includes(q));
  }, [dateTypes, draft.date_type]);

  const grouped = useMemo(() => {
    const groups: Record<string, ImportantDate[]> = { annual: [], monthly: [], weekly: [], custom: [] };
    for (const d of dates) {
      const key = d.recurrence === "custom" ? "custom" : d.recurrence === "weekly" ? "weekly" : d.recurrence === "monthly" ? "monthly" : "annual";
      groups[key].push(d);
    }
    for (const key of Object.keys(groups)) groups[key].sort(sortChronological);
    return groups;
  }, [dates]);

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setErrors({});
    setShowModal(true);
  }

  function openEdit(d: ImportantDate) {
    let customRule: CustomRule = { kind: "every", every_n: 1, every_unit: "год" };
    if (d.custom_rule) {
      try { customRule = JSON.parse(d.custom_rule); } catch {}
    }
    setDraft({
      title: d.title,
      description: d.description ?? "",
      date_type: d.date_type ?? "",
      color: d.color ?? "",
      recurrence: d.recurrence === "once" ? "annual" : (d.recurrence as Draft["recurrence"]),
      year: d.year != null ? String(d.year) : "",
      month: d.month != null ? String(d.month) : "",
      day: String(d.day),
      custom_rule: customRule,
      owner_type: d.owner_type ?? "",
      owner_id: d.owner_id ?? null,
    });
    setEditingId(d.id);
    setErrors({});
    setShowModal(true);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!draft.title.trim()) e.title = "Введите название";
    if (!draft.day) e.day = "Укажите день";
    if (draft.recurrence === "annual" && !draft.month) e.month = "Для ежегодного повтора нужен месяц";
    if (draft.owner_type && draft.owner_type !== "setting" && !draft.owner_id) e.owner = "Выберите владельца";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    const payload = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      date_type: draft.date_type.trim(),
      color: draft.color.trim(),
      recurrence: draft.recurrence,
      year: null as number | null,
      month: draft.recurrence !== "weekly" && draft.recurrence !== "custom" && draft.month ? Number(draft.month) : null,
      day: Number(draft.day),
      custom_rule: draft.recurrence === "custom" ? JSON.stringify(draft.custom_rule) : "",
      owner_type: draft.owner_type || "setting",
      owner_id: draft.owner_type === "setting" ? 0 : draft.owner_id,
    };
    if (editingId) {
      await api.put(`/settings/important-dates/${editingId}`, payload);
    } else {
      await api.post(`/settings/${settingId}/important-dates`, payload);
    }
    setShowModal(false);
    refresh();
    api.get<DateTypeSuggestion[]>(`/settings/${settingId}/date-types`).then(setDateTypes).catch(() => {});
  }

  async function handleClose() {
    if (editingId || draft.title.trim() || draft.description.trim()) {
      const ok = await confirm({ title: "Отменить изменения?", message: "Несохранённые данные будут потеряны.", confirmLabel: "ДА", cancelLabel: "НЕТ" });
      if (!ok) return;
    }
    setShowModal(false);
  }

  async function handleDelete(id: number, title: string) {
    const ok = await confirm({ title: "Удалить важную дату?", message: `«${title}» будет удалена.`, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    await api.del(`/settings/important-dates/${id}`);
    refresh();
  }

  function selectTypeSuggestion(s: DateTypeSuggestion) {
    setDraft((d) => ({ ...d, date_type: s.date_type, color: s.color }));
  }

  const currentOwners = draft.owner_type === "being" ? owners.beings
    : draft.owner_type === "community" ? owners.communities
    : draft.owner_type === "location" ? owners.locations : [];

  return (
    <div className="stack">
      <button className="primary" onClick={openCreate} style={{ alignSelf: "flex-start" }}>+ Добавить важную дату</button>

      {dates.length === 0 && <p className="muted">Важных дат пока нет.</p>}

      {(["annual", "monthly", "weekly", "custom"] as const).map((key) => {
        const items = grouped[key];
        if (items.length === 0) return null;
        return (
          <div key={key} className="stack" style={{ gap: 4 }}>
            <strong style={{ fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{GROUP_LABELS[key]}</strong>
            {items.map((d) => (
              <div key={d.id} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span className="row" style={{ gap: 6, alignItems: "center", minWidth: 0 }}>
                  {d.color && <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: d.color, flexShrink: 0 }} />}
                  <strong style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.title}</strong>
                  {d.date_type && <span className="badge tag" style={{ fontSize: "var(--fs-micro)", flexShrink: 0 }}>{d.date_type}</span>}
                  <span className="muted" style={{ fontSize: "var(--fs-meta)", whiteSpace: "nowrap" }}>
                    {formatImportantDate(d, effectiveMonths, weekdays)}
                    {d.owner_type === "setting" && <> · Для сеттинга</>}
                    {d.owner_name && <> · {d.owner_name}</>}
                  </span>
                </span>
                <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                  <button className="comp-mini" onClick={() => openEdit(d)}>✎</button>
                  <button className="comp-mini danger" onClick={() => handleDelete(d.id, d.title)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {showModal && (
        <Modal onClose={handleClose}>
          <h3>{editingId ? "Редактировать важную дату" : "Новая важная дата"}</h3>
          <div className="stack">
            {/* Название */}
            <div className="stack" style={{ gap: 2 }}>
              <input
                placeholder="Название"
                value={draft.title}
                onChange={(e) => { setDraft((d) => ({ ...d, title: e.target.value })); setErrors((er) => { const n = { ...er }; delete n.title; return n; }); }}
                style={errors.title ? { borderColor: "var(--danger-bg)" } : undefined}
              />
              {errors.title && <span className="muted" style={{ fontSize: "var(--fs-meta)", color: "var(--danger-bg)" }}>{errors.title}</span>}
            </div>

            <textarea placeholder="Описание (необязательно)" rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} style={{ resize: "vertical" }} />

            {/* Тип и цвет */}
            <div className="stack" style={{ gap: 4 }}>
              <strong style={{ fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Категория</strong>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  placeholder="Праздник, юбилей…"
                  value={draft.date_type}
                  onChange={(e) => setDraft((d) => ({ ...d, date_type: e.target.value }))}
                  list="date-type-suggestions"
                  style={{ width: 160 }}
                />
                <datalist id="date-type-suggestions">
                  {dateTypes.map((t) => <option key={t.date_type} value={t.date_type} />)}
                </datalist>
                {typeSuggestions.length > 0 && draft.date_type && (
                  <>
                    {typeSuggestions.slice(0, 4).map((s) => (
                      <button key={s.date_type} className="comp-mini" onClick={() => selectTypeSuggestion(s)} title={s.date_type}>
                        {s.color && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: s.color, marginRight: 4 }} />}
                        {s.date_type}
                      </button>
                    ))}
                  </>
                )}
                <label className="row" style={{ gap: 4, alignItems: "center" }}>
                  <input type="color" value={draft.color || "#808080"} onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))} style={{ width: 36, height: 28, padding: 0, cursor: "pointer" }} />
                  {draft.color && <button className="comp-mini" onClick={() => setDraft((d) => ({ ...d, color: "" }))}>✕</button>}
                </label>
              </div>
            </div>

            {/* Повтор */}
            <div className="stack" style={{ gap: 4 }}>
              <strong style={{ fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Повтор</strong>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <select value={draft.recurrence} onChange={(e) => setDraft((d) => ({ ...d, recurrence: e.target.value as Draft["recurrence"] }))}>
                  <option value="annual">ежегодно</option>
                  <option value="monthly">ежемесячно</option>
                  <option value="weekly">еженедельно</option>
                  <option value="custom">особое</option>
                </select>

                {draft.recurrence === "weekly" && (
                  <select value={draft.day} onChange={(e) => setDraft((d) => ({ ...d, day: e.target.value }))}>
                    {weekdays.map((w) => <option key={w.position} value={String(w.position)}>{w.name}</option>)}
                  </select>
                )}

                {draft.recurrence === "annual" && (
                  <select value={draft.month} onChange={(e) => { setDraft((d) => ({ ...d, month: e.target.value })); setErrors((er) => { const n = { ...er }; delete n.month; return n; }); }}>
                    <option value="">— выберите месяц —</option>
                    {(effectiveMonths.length > 0 ? effectiveMonths : MONTH_NAMES.map((m) => ({ position: m.value, name: m.label } as unknown as CalendarMonth))).map((m) => <option key={m.position} value={m.position}>{m.name}</option>)}
                  </select>
                )}

                {draft.recurrence !== "weekly" && draft.recurrence !== "custom" && (
                  <label className="row" style={{ gap: 4 }}>
                    День
                    <input type="number" min={1} max={60} value={draft.day} onChange={(e) => setDraft((d) => ({ ...d, day: e.target.value }))} style={{ width: 60 }} />
                  </label>
                )}
              </div>
              {errors.month && <span className="muted" style={{ fontSize: "var(--fs-meta)", color: "var(--danger-bg)" }}>{errors.month}</span>}
            </div>

            {/* Особое правило */}
            {draft.recurrence === "custom" && (
              <div className="stack" style={{ gap: 8, padding: "10px 12px", background: "var(--paper-2, #f5f5f5)", borderRadius: "var(--card-radius, 6px)", border: "1px solid var(--border, #e0e0e0)" }}>
                <strong style={{ fontSize: "var(--fs-meta)" }}>Особое правило</strong>

                <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={draft.custom_rule.kind}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      custom_rule: e.target.value === "every"
                        ? { kind: "every", every_n: 1, every_unit: "год" }
                        : { kind: "ordinal", ordinal: 1, ordinal_unit: weekdaysList[0] ?? "понедельник", in_unit: "месяц" },
                    }))}
                  >
                    <option value="every">Раз в…</option>
                    <option value="ordinal">Каждый…</option>
                  </select>
                </div>

                {draft.custom_rule.kind === "every" && (
                  <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="muted">Раз в</span>
                    <input
                      type="number"
                      min={1}
                      value={draft.custom_rule.every_n ?? 1}
                      onChange={(e) => setDraft((d) => ({ ...d, custom_rule: { ...d.custom_rule, every_n: Number(e.target.value) || 1 } }))}
                      style={{ width: 60 }}
                    />
                    <select
                      value={draft.custom_rule.every_unit ?? "год"}
                      onChange={(e) => setDraft((d) => ({ ...d, custom_rule: { ...d.custom_rule, every_unit: e.target.value } }))}
                    >
                      {CUSTOM_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                      → раз в {everyPreview(draft.custom_rule.every_n ?? 1, draft.custom_rule.every_unit ?? "год")}
                    </span>
                  </div>
                )}

                {draft.custom_rule.kind === "ordinal" && (
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="muted">Каждый</span>
                      <input
                        type="number"
                        min={1}
                        value={draft.custom_rule.ordinal ?? 1}
                        onChange={(e) => setDraft((d) => ({ ...d, custom_rule: { ...d.custom_rule, ordinal: Number(e.target.value) || 1 } }))}
                        style={{ width: 60 }}
                      />
                      <select
                        value={draft.custom_rule.ordinal_unit ?? weekdaysList[0] ?? "понедельник"}
                        onChange={(e) => setDraft((d) => ({ ...d, custom_rule: { ...d.custom_rule, ordinal_unit: e.target.value } }))}
                      >
                        <optgroup label="День недели">
                          {weekdaysList.map((w) => <option key={w} value={w}>{w}</option>)}
                        </optgroup>
                        <optgroup label="Период">
                          <option value="день">день</option>
                          <option value="неделя">неделя</option>
                          <option value="месяц">месяц</option>
                          <option value="год">год</option>
                        </optgroup>
                      </select>
                      <span className="muted">в</span>
                      <select
                        value={draft.custom_rule.in_unit ?? "месяц"}
                        onChange={(e) => setDraft((d) => ({ ...d, custom_rule: { ...d.custom_rule, in_unit: e.target.value } }))}
                      >
                        <option value="месяц">месяц</option>
                        <option value="год">год</option>
                        <option value="десятилетие">десятилетие</option>
                        <option value="столетие">столетие</option>
                      </select>
                    </div>
                    <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                      → {ordinalPreview(draft.custom_rule.ordinal ?? 1, draft.custom_rule.ordinal_unit ?? weekdaysList[0] ?? "понедельник", draft.custom_rule.in_unit ?? "месяц")}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Владелец */}
            <div className="stack" style={{ gap: 4 }}>
              <strong style={{ fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Владелец</strong>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <select value={draft.owner_type} onChange={(e) => setDraft((d) => ({ ...d, owner_type: e.target.value as Draft["owner_type"], owner_id: null }))}>
                  <option value="">— выбрать —</option>
                  <option value="setting">Для сеттинга</option>
                  <option value="being">Личность</option>
                  <option value="community">Фракция</option>
                  <option value="location">Локация</option>
                </select>
                {draft.owner_type && draft.owner_type !== "setting" && (
                  <select value={draft.owner_id ?? ""} onChange={(e) => { setDraft((d) => ({ ...d, owner_id: e.target.value ? Number(e.target.value) : null })); setErrors((er) => { const n = { ...er }; delete n.owner; return n; }); }}>
                    <option value="">— выберите {OWNER_LABELS[draft.owner_type]?.toLowerCase() ?? "владельца"} —</option>
                    {currentOwners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
              </div>
              {errors.owner && <span className="muted" style={{ fontSize: "var(--fs-meta)", color: "var(--danger-bg)" }}>{errors.owner}</span>}
            </div>

            {/* Кнопки */}
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button onClick={handleClose}>Отмена</button>
              <button className="primary" onClick={save}>{editingId ? "Сохранить" : "Создать"}</button>
            </div>
          </div>
        </Modal>
      )}
      {confirmDialog}
    </div>
  );
}
