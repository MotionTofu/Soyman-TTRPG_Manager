import { useState, type MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Modal } from "./Modal";
import { TypeGlyph } from "./TypeGlyph";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { attemptWithNotice } from "../data/notices";
import { safeGetItem, safeSetItem } from "../utils/safeStorage";
import "./WebInbox.css";

// Входящие Мешка: фрагменты, присланные расширением браузера (гриллинг
// 2026-11-05, Q12–Q16; .scratch/web-sources/extension-decisions.md).
// Записи на сервере — расширение пишет туда, Мешок их только показывает.

export type InboxItem = {
  id: string; kind: string; url: string; page_title: string; heading: string; text: string; captured_at: string;
};

export const INBOX_PATH = "/web-capture/inbox";

/** Опрос раз в 5 с: фрагмент приходит из другого приложения, событие сюда не долетит. */
export function useWebInbox(enabled: boolean) {
  return useResource<InboxItem[]>(enabled ? INBOX_PATH : null, { pollMs: 5000 });
}

type Kind = "being" | "location" | "community" | "artifact";
const KINDS: { kind: Kind; label: string; path: string; detail: string }[] = [
  { kind: "being", label: "Существо", path: "/setting-beings", detail: "/beings" },
  { kind: "location", label: "Место", path: "/setting-locations", detail: "/locations" },
  { kind: "community", label: "Сообщество", path: "/setting-communities", detail: "/communities" },
  { kind: "artifact", label: "Артефакт", path: "/artifacts", detail: "/artifacts" },
];
const KIND_KEY = "webInbox.kind";
const SETTING_KEY = "webInbox.settingId";

function host(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

/** Markdown фрагмента — в строку для превью: без значков разметки. */
function plain(md: string): string {
  return md.replace(/[*_`#>|]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Название по умолчанию (Q19): главный заголовок страницы, иначе заголовок вкладки без имени сайта. */
function defaultName(item: InboxItem): string {
  const heading = item.heading.trim();
  if (heading) return heading.slice(0, 200);
  return item.page_title.split(/\s+[—|–-]\s+/)[0].trim().slice(0, 200);
}

export function WebInbox({ items }: { items: InboxItem[] }) {
  const afterWrite = useAfterWrite();
  const [creating, setCreating] = useState<InboxItem | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: InboxItem } | null>(null);

  async function remove(item: InboxItem) {
    if (await attemptWithNotice("Фрагмент не удалён", () => write.del(`/web-capture/inbox/${item.id}`))) {
      afterWrite([{ path: INBOX_PATH }]);
    }
  }

  function openMenu(e: MouseEvent, item: InboxItem) {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu(e.type === "contextmenu" ? { x: e.clientX, y: e.clientY, item } : { x: r.left, y: r.bottom, item });
  }

  const menuItems = (item: InboxItem): ContextMenuItem[] => [
    { label: "Создать сущность…", onClick: () => setCreating(item) },
    { label: "Открыть страницу", dividerBefore: true, onClick: () => window.open(item.url, "_blank", "noopener,noreferrer") },
    { label: "Удалить", danger: true, dividerBefore: true, hint: "Del", onClick: () => void remove(item) },
  ];

  // Окно разбора — вне списка: последний фрагмент уходит из Входящих, а окно
  // «Создано» должно остаться.
  return <>
    {!items.length && <p className="web-inbox__empty">
      Пусто. На сайте: выделить текст → ПКМ → SoyMan → «Во входящие». Расширение подключается в Настройках, вкладка «Расширение».
    </p>}
    {items.length > 0 && <ul className="web-inbox" aria-label="Входящие">
      {items.map((item) => <li key={item.id} className="web-inbox__row" onContextMenu={(e) => openMenu(e, item)}
        onKeyDown={(e) => { if (e.key === "Delete" && e.target === e.currentTarget) void remove(item); }} tabIndex={0}>
        <svg className="web-inbox__kind" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path d="M10 4h9M14 4v16M10 4a4 4 0 000 8h4" />
        </svg>
        <div className="web-inbox__body">
          <b title={item.page_title}>{item.page_title || host(item.url)}</b>
          <p>{plain(item.text)}</p>
          <small>{host(item.url)} · {when(item.captured_at)}</small>
          <div className="web-inbox__acts">
            <button type="button" className="d-btn d-btn--sm" onClick={() => setCreating(item)}>Сущность</button>
            <button type="button" className="d-dots" aria-label="Ещё действия с фрагментом" aria-haspopup="menu"
              onClick={(e) => openMenu(e, item)}>⋯</button>
          </div>
        </div>
      </li>)}
    </ul>}
    {menu && <ContextMenu x={menu.x} y={menu.y} title={`Фрагмент · ${host(menu.item.url)}`} ariaLabel="Действия с фрагментом"
      items={menuItems(menu.item)} onClose={() => setMenu(null)} />}
    {creating && <CreateFromFragment item={creating} onClose={() => setCreating(null)} />}
  </>;
}

type Setting = { id: number; name: string };

function CreateFromFragment({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const afterWrite = useAfterWrite();
  const settings = useResource<Setting[]>("/settings").data ?? [];
  const [kind, setKind] = useState<Kind>(() => (KINDS.find((k) => k.kind === safeGetItem(KIND_KEY))?.kind ?? "being"));
  const here = Number(useLocation().pathname.match(/^\/settings\/(\d+)/)?.[1]) || 0;
  const [pickedSetting, setPickedSetting] = useState<number>(() => here || Number(safeGetItem(SETTING_KEY)) || 0);
  const [name, setName] = useState(() => defaultName(item));
  const [description, setDescription] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Сущность уже создана, а следующий шаг упал: повтор не создаёт вторую.
  const [pending, setPending] = useState<{ id: number; kind: Kind; described: boolean } | null>(null);
  const [done, setDone] = useState<{ id: number; name: string; detail: string } | null>(null);

  const settingId = settings.some((s) => s.id === pickedSetting) ? pickedSetting : settings.length === 1 ? settings[0].id : 0;
  const config = KINDS.find((k) => k.kind === kind)!;
  const ready = !!name.trim() && !!settingId && !busy;

  async function save() {
    if (!ready) return;
    setBusy(true); setError("");
    let target = pending;
    try {
      if (!target) {
        const created = await write.post<{ id: number }>(config.path, { name: name.trim(), setting_id: settingId });
        target = { id: created.id, kind, described: false };
        setPending(target);
      }
      const cfg = KINDS.find((k) => k.kind === target!.kind)!;
      if (!target.described) {
        await write.put(`${cfg.path}/${target.id}`, { description });
        target = { ...target, described: true };
        setPending(target);
      }
      await write.post(`/web-capture/inbox/${item.id}/attach`, { target_kind: target.kind, target_id: target.id, field_name: "description" });
      safeSetItem(KIND_KEY, target.kind);
      safeSetItem(SETTING_KEY, String(settingId));
      afterWrite([{ path: INBOX_PATH }, { path: cfg.path }, { path: `/web-capture/sources/entity/${target.kind}/${target.id}` }]);
      setDone({ id: target.id, name: name.trim(), detail: `${cfg.detail}/${target.id}` });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не сохранилось. Повторите — вторая сущность не появится.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <Modal onClose={onClose} ariaLabel="Сущность создана">
      <h2>Создано</h2>
      <p><Link to={done.detail} onClick={onClose}>{done.name}</Link> — источник сохранён, фрагмент ушёл из Входящих.</p>
      <div className="modal-footer row"><button type="button" className="primary" onClick={onClose}>Закрыть</button></div>
    </Modal>;
  }

  return <Modal onClose={onClose} wide closeOnBackdropClick={false} ariaLabel="Новая сущность из фрагмента" className="web-create">
    <h2>Новая сущность из фрагмента</h2>
    <div className="web-create__grid">
      <div className="web-create__form">
        <span className="web-create__label" id="web-create-kind">Вид</span>
        <div className="web-create__kinds" role="radiogroup" aria-labelledby="web-create-kind">
          {KINDS.map((k) => <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind}
            disabled={!!pending} className={kind === k.kind ? "active" : ""} onClick={() => setKind(k.kind)}>
            <TypeGlyph type={k.kind} />{k.label}
          </button>)}
        </div>
        <div className="web-create__pair">
          <label className="web-create__label">Сеттинг
            <select className="d-select" value={settingId} disabled={!!pending} onChange={(e) => setPickedSetting(Number(e.target.value))}>
              <option value={0}>Выберите сеттинг</option>
              {settings.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="web-create__label">Название
            <input className="d-input" value={name} disabled={!!pending} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
        </div>
        <label className="web-create__label">Описание
          <textarea value={description} disabled={!!pending?.described} rows={9} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      <section className="web-create__source" aria-label="Источник">
        <h3 className="d-plate">Источник</h3>
        <b>{item.page_title || host(item.url)}</b>
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="web-create__url">{item.url}</a>
        <blockquote>{item.text}</blockquote>
        <dl>
          <dt>Графа</dt><dd>Описание</dd>
          <dt>Взято</dt><dd>{new Date(item.captured_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</dd>
        </dl>
      </section>
    </div>
    {error && <p className="web-create__error" role="alert">{error}</p>}
    <div className="modal-footer row">
      <span className="web-create__note">Фрагмент уйдёт из Входящих</span>
      <button type="button" onClick={onClose}>Отмена</button>
      <button type="button" className="primary" disabled={!ready} onClick={() => void save()}>
        {busy ? "Сохраняю…" : pending ? "Повторить" : "Создать"}
      </button>
    </div>
  </Modal>;
}
