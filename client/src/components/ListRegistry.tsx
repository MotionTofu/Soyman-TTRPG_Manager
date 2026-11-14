// Шаблон списка «Реестр» (гриллинг 2026-11-05, Q1–Q18; доски Reg-* на
// странице холста «Сквозное»). Кампании, Сеттинги, Игроки, Системы — одна
// грамматика: плитки одного размера сеткой «сколько влезет», ⋯ и ПКМ на
// каждой записи, «Список» — таблица с заголовками, внизу свёрнутый «Архив N».
// Каркас страницы (сегменты групп, поиск, счётчик, переключатель вида) —
// `ListPage`; здесь — то, из чего страница собирает тело.
import "./list-registry.css";
import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import type { Affect } from "../data/entities";
import { entityMark, openEntityMenu, type EntityRef } from "../pageMenu";
import { EntityMenuButton } from "./PageContextMenu";
import type { ContextMenuItem } from "./ContextMenu";
import { useCurrentUser } from "../api/currentUser";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import type { ArchiveItem } from "../types";

export type ListView = "tiles" | "rows";

/** Вид списка запоминается на список и на этот браузер (Q6). */
export function useListView(key: string): [ListView, (view: ListView) => void] {
  const storageKey = `soyman.listView.${key}`;
  const [view, setView] = useState<ListView>(() => {
    try {
      return localStorage.getItem(storageKey) === "rows" ? "rows" : "tiles";
    } catch {
      return "tiles";
    }
  });
  function change(next: ListView) {
    setView(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Хранилище закрыто (приватное окно) — вид живёт до перезагрузки.
    }
  }
  return [view, change];
}

/** Обложка из данных: файл хранилища — через авторизованный blob, внешний адрес — как есть. */
function useCoverBg(raw: string | null | undefined): string | undefined {
  const url = raw && isSafeImageUrl(raw) ? raw : null;
  const blob = useAuthenticatedFileUrl(url);
  if (!url) return undefined;
  return url.startsWith("/files/") ? (blob ? `url("${blob}")` : undefined) : safeBackgroundImage(url);
}

function menuHandler(entity: EntityRef, local: ContextMenuItem[] | undefined) {
  return (event: MouseEvent) => {
    if (event.shiftKey) return;
    event.preventDefault();
    openEntityMenu(entity, event.clientX, event.clientY, local);
  };
}

export function RegTiles({ children }: { children: ReactNode }) {
  return <div className="reg-tiles">{children}</div>;
}

export interface RegTileProps {
  entity: EntityRef;
  to: string;
  /** Адрес обложки из данных. Нет — заглушка с первой буквой или знаком. */
  image?: string | null;
  /** Вместо буквы на пустой обложке (знак типа у игрока). */
  placeholder?: ReactNode;
  /** Плашка в углу обложки: система у кампании, код у системы. */
  plate?: string | null;
  menu?: ContextMenuItem[];
  title?: string;
  /** Под названием: жанры, заметка, строка машинописью. */
  children?: ReactNode;
}

export function RegTile({ entity, to, image, placeholder, plate, menu, title, children }: RegTileProps) {
  const bg = useCoverBg(image);
  return (
    <article className="reg-tile" {...entityMark(entity.type, entity.id, entity.name)} onContextMenu={menuHandler(entity, menu)}>
      {/* инлайн-стиль намеренно — обложка: адрес картинки приходит из данных */}
      <span className={`reg-tile__cover${bg ? "" : " is-empty"}`} style={bg ? { backgroundImage: bg } : undefined} aria-hidden="true">
        {!bg && (placeholder ?? <span className="reg-tile__letter">{entity.name.slice(0, 1)}</span>)}
        {plate && <span className="d-plate">{plate}</span>}
      </span>
      <div className="reg-tile__body">
        <h3 className="reg-tile__name">
          <Link to={to} title={title}>{entity.name}</Link>
        </h3>
        {children}
      </div>
      <EntityMenuButton entity={entity} local={menu} />
    </article>
  );
}

/** Строка машинописью внизу плитки; `none` — приглушённая («нет кампаний»). */
export function RegMeta({ children, none }: { children: ReactNode; none?: boolean }) {
  return <span className={`reg-meta${none ? " is-none" : ""}`}>{children}</span>;
}

/** Последняя плитка открытой группы (Q12): действие там, где появится результат. */
export function RegAddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="reg-tile reg-tile--add" onClick={onClick}>
      {label}
    </button>
  );
}

export interface RegColumn {
  label: string;
  /** Ширина колонки сетки: `minmax(0, 1fr)`, `150px`. */
  width: string;
  /** Остаётся на телефоне (Q15): название всегда, плюс одна главная колонка. */
  phone?: boolean;
}

export function RegTable({ columns, label, children }: { columns: RegColumn[]; label: string; children: ReactNode }) {
  const cols = `${columns.map((c) => c.width).join(" ")} 40px`;
  const phoneCols = `${columns.filter((c, i) => i === 0 || c.phone).map((c) => c.width).join(" ")} 40px`;
  const style = { "--reg-cols": cols, "--reg-cols-phone": phoneCols } as CSSProperties;
  return (
    <div className="reg-table" role="table" aria-label={label} style={style}>
      <div className="reg-table__head" role="row">
        {columns.map((c, i) => (
          <span key={c.label} role="columnheader" className={i === 0 || c.phone ? undefined : "reg-wide"}>{c.label}</span>
        ))}
        <span role="columnheader" aria-label="Действия" />
      </div>
      {children}
    </div>
  );
}

export interface RegRowProps {
  entity: EntityRef;
  to: string;
  columns: RegColumn[];
  /** Ячейки после названия — по колонкам начиная со второй. */
  cells: ReactNode[];
  menu?: ContextMenuItem[];
}

export function RegRow({ entity, to, columns, cells, menu }: RegRowProps) {
  return (
    <div className="reg-row" role="row" {...entityMark(entity.type, entity.id, entity.name)} onContextMenu={menuHandler(entity, menu)}>
      <span role="cell" className="reg-row__name"><Link to={to}>{entity.name}</Link></span>
      {cells.map((cell, i) => (
        <span key={i} role="cell" className={columns[i + 1]?.phone ? "reg-row__cell" : "reg-row__cell reg-wide"}>{cell}</span>
      ))}
      <span role="cell"><EntityMenuButton entity={entity} local={menu} /></span>
    </div>
  );
}

export function RegAddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="reg-add-row" onClick={onClick}>
      {label}
    </button>
  );
}

/** Раздел под «Все» (Q9 — только по статусу): плашка, число, содержимое. */
export function RegSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="reg-section" aria-label={title}>
      <div className="d-gh">
        <h2 className="d-plate">{title}</h2>
        <span className="d-note">{count}</span>
      </div>
      {children}
    </section>
  );
}

const NO_ARCHIVE: ArchiveItem[] = [];
const archivedDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

/**
 * Свёрнутая строка «Архив N» внизу списка (Q11): раскрывается строками на
 * месте, у каждой — «Вернуть». Нет архивных — строки нет. Только Мастеру:
 * архив — его кухня, а у игрока в списке кампаний ему не место.
 */
export function RegArchive({ type, basePath, affects, include }: {
  type: string; basePath: string; affects: Affect[]; include?: (item: ArchiveItem) => boolean;
}) {
  const { user } = useCurrentUser();
  const isGm = user?.role === "gm";
  const archive = useResource<ArchiveItem[]>(isGm ? "/archive" : null);
  const items = (archive.data ?? NO_ARCHIVE).filter((a) => a.type === type && (!include || include(a)));
  const [open, setOpen] = useState(false);
  const run = useAction();
  if (!isGm || items.length === 0) return null;
  async function restore(id: number) {
    await run(() => write.put(`${basePath}/${id}/restore`).then(() => true), { affects: [...affects, { path: "/archive" }] });
  }
  return (
    <section className="reg-arch" aria-label="Архив">
      <button type="button" className="reg-arch__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <b>Архив</b>
        <span className="d-note">{items.length}</span>
        <span className="d-mono">{open ? "Скрыть ‹" : "Показать ›"}</span>
      </button>
      {open && (
        <ul className="reg-arch__rows">
          {items.map((a) => (
            <li key={a.id}>
              <span>{a.title}</span>
              <span className="d-note">в архиве с {archivedDate(a.archived_at)}</span>
              <button type="button" className="d-btn d-btn--sm" onClick={() => void restore(a.id)}>
                Вернуть
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
