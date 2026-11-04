import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { getCachedUser } from "../api/currentUser";
import { addToBag } from "../bag";
import { useAfterWrite, write } from "../data/hooks";
import { entityPath, isEntityKind } from "../data/entities";
import { openSecondWindow } from "../electronApi";
import { DETAIL_ROUTES } from "../entityTypes";
import { useConfirm } from "../hooks/useConfirm";
import { buildMentionToken } from "../mentions";
import { buildPageLabel, usePinnedPages } from "../pinnedPages";
import { loadSearchEngine, searchWeb } from "../searchEngine";
import { APP_SEARCH_EVENT, ENTITY_MENU_EVENT, openEntityMenu, type EntityRef } from "../pageMenu";

// ПКМ страниц — одна общая точка (design-system.md §6.12, гриллинг Q1–Q21).
// Слушает правую кнопку по всему документу и строит меню по месту щелчка:
// поле > объект > картинка > выделенный текст > фон страницы. Объект — любой
// элемент с меткой `entityMark`; местные пункты страница передаёт сама через
// `openEntityMenu`. Меню, которые страница открыла сама (preventDefault), эта
// точка не трогает — так старые меню живут, пока их переводят по трекеру.
// Shift+ПКМ — меню системы.

/** «⋯» на строке и карточке (Q6): то же меню, что по правой кнопке. */
export function EntityMenuButton({ entity, local }: { entity: EntityRef; local?: ContextMenuItem[] }) {
  return (
    <button
      type="button"
      className="entity-dots"
      aria-label={`Действия: ${entity.name}`}
      aria-haspopup="menu"
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        openEntityMenu(entity, r.left, r.bottom + 2, local);
      }}
    >
      ⋯
    </button>
  );
}

type Request =
  | { kind: "entity"; entity: EntityRef; local: ContextMenuItem[] }
  | { kind: "image"; src: string }
  | { kind: "text"; text: string }
  | { kind: "field"; field: HTMLInputElement | HTMLTextAreaElement }
  | { kind: "page"; local?: ContextMenuItem[] };

const ARCHIVABLE = new Set(["campaign", "setting", "player", "session", "character", "location", "being", "artifact", "community", "adventure", "scene"]);
const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "number", ""]);

function entityRoute(e: EntityRef) {
  const base = DETAIL_ROUTES[e.type];
  return base ? `${base}/${e.id}` : null;
}

function readEntity(el: Element): EntityRef | null {
  const host = el.closest<HTMLElement>("[data-entity-type][data-entity-id]");
  if (!host) return null;
  const id = Number(host.dataset.entityId);
  if (!Number.isFinite(id)) return null;
  return { type: host.dataset.entityType!, id, name: host.dataset.entityName || host.textContent?.trim() || "" };
}

function classify(target: Element): Request {
  const field = target.closest("input, textarea");
  if (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && TEXT_INPUTS.has(field.type))) return { kind: "field", field };
  const entity = readEntity(target);
  if (entity) return { kind: "entity", entity, local: [] };
  if (target instanceof HTMLImageElement && target.currentSrc) return { kind: "image", src: target.currentSrc };
  const text = window.getSelection()?.toString().trim();
  if (text) return { kind: "text", text };
  return { kind: "page" };
}

async function copyImage(src: string) {
  let blob = await (await fetch(src)).blob();
  // Буфер обмена принимает только PNG — остальное перерисовывается.
  if (blob.type !== "image/png") {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("png"))), "image/png"));
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

// Поиск по картинке у поисковиков принимает только публичный адрес, а картинки
// приложения лежат на localhost. Поэтому картинка кладётся в буфер, а страница
// поиска открывается пустой — туда её вставляют Ctrl+V.
const IMAGE_SEARCH: Record<string, { label: string; url: string }> = {
  google: { label: "Google", url: "https://lens.google.com/" },
  yandex: { label: "Яндекс", url: "https://yandex.ru/images/" },
};

function fieldEdit(field: HTMLInputElement | HTMLTextAreaElement, command: "cut" | "copy" | "insertText", text?: string) {
  field.focus();
  document.execCommand(command, false, text);
}

export function PageContextMenu() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { pin } = usePinnedPages();
  const afterWrite = useAfterWrite();
  const [dialog, confirm] = useConfirm();
  const [menu, setMenu] = useState<(Request & { x: number; y: number }) | null>(null);
  const [spell, setSpell] = useState<{ word: string; suggestions: string[] } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      if (e.defaultPrevented || e.shiftKey || !(e.target instanceof Element)) return;
      if (e.target.closest(".context-menu")) return;
      e.preventDefault();
      setSpell(null);
      setMenu({ ...classify(e.target), x: e.clientX, y: e.clientY });
    }
    // Menu / Shift+F10 (Q19): браузер шлёт contextmenu с зажатым Shift и без
    // координат — тогда его не отличить от Shift+ПКМ. Поэтому клавиша сама
    // шлёт элементу в фокусе обычный щелчок правой у его левого нижнего угла;
    // его получат и меню страниц, не только общая точка.
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ContextMenu" && !(e.key === "F10" && e.shiftKey)) return;
      const target = document.activeElement instanceof Element ? document.activeElement : document.body;
      if (target.closest(".context-menu")) return;
      e.preventDefault();
      const r = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.left + 8, clientY: r.bottom }));
    }
    function onOpen(e: Event) {
      setMenu((e as CustomEvent<Request & { x: number; y: number }>).detail);
    }
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener(ENTITY_MENU_EVENT, onOpen);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener(ENTITY_MENU_EVENT, onOpen);
    };
  }, []);

  // Варианты орфографии Electron присылает чуть позже открытия меню поля.
  useEffect(() => {
    if (menu?.kind !== "field" || !window.electronAPI?.onSpellContext) return;
    return window.electronAPI.onSpellContext(({ word, suggestions }) => word && setSpell({ word, suggestions: suggestions.slice(0, 5) }));
  }, [menu]);

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setViewing(null);
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [viewing]);

  const isGm = getCachedUser()?.role !== "player";
  const clip = navigator.clipboard;
  const group = (items: (ContextMenuItem | false | null | undefined | "")[]) => items.filter(Boolean) as ContextMenuItem[];
  const join = (groups: ContextMenuItem[][]) =>
    groups.filter((g) => g.length).flatMap((g, i) => g.map((item, j) => (i > 0 && j === 0 ? { ...item, dividerBefore: true } : item)));

  async function archive(entity: EntityRef) {
    const ok = await confirm({
      title: "В архив",
      message: `«${entity.name}» уйдёт в архив. Вернуть можно со страницы «Архив».`,
      confirmLabel: "В архив",
      danger: true,
    });
    if (!ok || !isEntityKind(entity.type)) return;
    await write.del(entityPath(entity.type, entity.id));
    afterWrite([{ kind: entity.type }]);
  }

  function entityItems(entity: EntityRef, local: ContextMenuItem[]): ContextMenuItem[] {
    const route = entityRoute(entity);
    return join([
      local.filter((item) => !item.danger),
      group([
        route && { label: "Открыть", onClick: () => navigate(route) },
        route && { label: "Открыть вторым окном", onClick: () => openSecondWindow(route) },
      ]),
      group([
        { label: "В мешок", onClick: () => addToBag({ type: entity.type, id: entity.id, title: entity.name }) },
        route && { label: "Закрепить", onClick: () => pin(route, entity.name) },
        clip && {
          label: "Копировать упоминание",
          onClick: () => void buildMentionToken(entity.type, entity.id, entity.name).then((t) => { if (t) void clip.writeText(t); }),
        },
      ]),
      group([...local.filter((item) => item.danger), isGm && ARCHIVABLE.has(entity.type) && !local.some((item) => item.danger && /архив/i.test(item.label)) && { label: "В архив", danger: true, onClick: () => void archive(entity) }]),
    ]);
  }

  function items(m: Request): ContextMenuItem[] {
    const engine = loadSearchEngine();
    switch (m.kind) {
      case "entity":
        return entityItems(m.entity, m.local);
      case "text":
        return join([
          group([clip && { label: "Копировать", hint: "Ctrl+C", onClick: () => void clip.writeText(m.text) }]),
          group([
            { label: `Найти в ${engine.label}`, onClick: () => searchWeb(m.text) },
            { label: "Найти в приложении", onClick: () => window.dispatchEvent(new CustomEvent(APP_SEARCH_EVENT, { detail: m.text })) },
          ]),
        ]);
      case "image": {
        const lens = IMAGE_SEARCH[engine.id] ?? IMAGE_SEARCH.google;
        return join([
          group([{ label: "Открыть просмотр", onClick: () => setViewing(m.src) }]),
          group([
            clip && {
              label: `Найти похожие в ${lens.label}`,
              hint: "Ctrl+V",
              onClick: () => void copyImage(m.src).then(() => searchWebUrl(lens.url)),
            },
            clip && { label: "Копировать картинку", onClick: () => void copyImage(m.src) },
            { label: "Сохранить картинку…", onClick: () => saveImage(m.src) },
          ]),
        ]);
      }
      case "field": {
        const f = m.field;
        const selected = f.value.slice(f.selectionStart ?? 0, f.selectionEnd ?? 0);
        const editable = !f.readOnly && !f.disabled;
        return join([
          spell && editable
            ? spell.suggestions.length
              ? spell.suggestions.map((word) => ({ label: word, onClick: () => replaceWord(f, spell.word, word) }))
              : [{ label: "Нет вариантов" }]
            : [],
          group([
            selected && editable && { label: "Вырезать", hint: "Ctrl+X", onClick: () => fieldEdit(f, "cut") },
            selected && { label: "Копировать", hint: "Ctrl+C", onClick: () => fieldEdit(f, "copy") },
            editable && clip?.readText && {
              label: "Вставить",
              hint: "Ctrl+V",
              onClick: () => void clip.readText().then((t) => t && fieldEdit(f, "insertText", t)),
            },
          ]),
        ]);
      }
      case "page": {
        const here = pathname + search;
        return join([
          m.local ?? [],
          group([{ label: "Открыть вторым окном", onClick: () => openSecondWindow(here) }]),
          group([
            { label: "Закрепить страницу", onClick: () => pin(here, buildPageLabel(pathname, search)) },
            clip && { label: "Копировать ссылку", onClick: () => void clip.writeText(window.location.href) },
          ]),
        ]);
      }
    }
  }

  const title =
    menu?.kind === "entity" ? menu.entity.name :
    menu?.kind === "image" ? "Картинка" :
    menu?.kind === "page" ? buildPageLabel(pathname, search) : undefined;

  // Нечего предложить — меню не открывается вовсе, а не пустой лист.
  const list = menu ? items(menu) : [];
  return (
    <>
      {menu && list.length > 0 && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={title}
          glyph={menu.kind === "entity" ? menu.entity.type : undefined}
          ariaLabel={title ?? "Действия"}
          items={list}
          footer={menu.kind === "page" ? "Shift+ПКМ — меню системы" : undefined}
          onClose={() => setMenu(null)}
        />
      )}
      {viewing && (
        <div className="image-view" role="dialog" aria-label="Просмотр картинки" onClick={() => setViewing(null)}>
          <img src={viewing} alt="" />
        </div>
      )}
      {dialog}
    </>
  );
}

function searchWebUrl(url: string) {
  if (window.electronAPI) window.electronAPI.openExternal(url);
  else window.open(url, "_blank", "noopener");
}

function saveImage(src: string) {
  const a = document.createElement("a");
  a.href = src;
  a.download = decodeURIComponent(src.split("/").pop()?.split("?")[0] || "картинка");
  a.click();
}

// Слово с ошибкой ищется вокруг каретки: правый щелчок ставит её туда, где щёлкнули.
function replaceWord(field: HTMLInputElement | HTMLTextAreaElement, word: string, next: string) {
  const near = field.selectionStart ?? 0;
  let at = field.value.lastIndexOf(word, near);
  if (at < 0 || at + word.length < near) at = field.value.indexOf(word, Math.max(0, near - word.length));
  if (at < 0) return;
  field.focus();
  field.setSelectionRange(at, at + word.length);
  document.execCommand("insertText", false, next);
}
