import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Lexer, marked, type Token, type Tokens } from "marked";
import { ANY_MENTION_RE, mentionTone, resolveMention, useMentionIndex } from "../../mentions";
import { DeadMention } from "./DeadMention";
import { SIDE_LABEL, parseImageLayout } from "./imageLayout";
import { openMentionPreview } from "./mentionPreviewStore";
import { getCachedUser } from "../../api/currentUser";
import { useResource } from "../../data/hooks";

type LinkedResource = { uid: string; id: number; name: string; type: string; category: string | null; file_url: string | null };
const RESOURCE_URL_RE = /^soyman:resource\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const RESOURCE_URL_SCAN = /soyman:resource\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const IMAGE_FILE_RE = /\.(?:png|jpe?g|gif|webp|avif)(?:\?|$)/i;

function isImageResource(resource: LinkedResource): boolean {
  return resource.category === "image" || !!resource.file_url && IMAGE_FILE_RE.test(resource.file_url);
}

function resourceTarget(resource: LinkedResource): string | null {
  if (!resource.file_url) return null;
  if (resource.category === "pdf") return `/resources/${resource.id}/read`;
  if (resource.type === "markdown") return `/resources/${resource.id}/markdown-file`;
  return `/resources/link/${resource.uid}`;
}

// Inline markup recognized inside any text field, alongside the existing
// [[type:id|Label]] mention token: **bold**, *italic*, [label](url) external
// links, and {span color="…" size="…" font="…"}…{/span} styled runs. A line
// starting with #/##/### is a heading, a line starting with "- " is a
// bullet-list item (consecutive "- " lines are grouped into one <ul>).
// Первая ветка — ссылка на сущность: `[[being@8f3c1a2e|wdh|Мирт]]`. Куда она
// ведёт и ведёт ли вообще, решает карта глобальных ключей (mentions.ts): ключ
// нашёлся — обычная ссылка, не нашёлся — зачёркнутая, объясняющая, какого
// модуля не хватает. Состояние не записано в текст, а вычисляется, поэтому
// ссылка оживает и гаснет сама, без проходов по базе.
//
// Вторая ветка — наследство `[[being:412|Мирт]]` с локальным id. Только
// читается. Стоит второй не случайно: обе начинаются с «[[», и если первой
// пробовать её, `(\d+)` не совпадёт с «@», а разбор уедет в следующий токен.
const TOKEN_RE =
  /\[\[(\w+)@([0-9a-fA-F][0-9a-fA-F-]{7,})\|([^|\]]*)\|([^\]]*)\]\]|\[\[(\w+):(\d+)\|([^\]]+)\]\]|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\{span([^}]*)\}|\{quote\}|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/;

function parseSpanAttrs(attrs: string): CSSProperties {
  const style: CSSProperties = {};
  const attrRe = /(\w+)="([^"]*)"/g;
  const allowedFonts = new Set(["PT Mono", "Oswald", "Cormorant SC", "JetBrains Mono", "Rubik Dirt", "RussianPunk", "NewZelek", "RookiePunk", "serif", "monospace", "sans-serif"]);
  for (const m of attrs.matchAll(attrRe)) {
    const [, key, val] = m;
    if (/[;{}]/.test(val)) continue;
    if (key === "color") {
      const okHex = /^#[0-9a-fA-F]{3,8}$/.test(val);
      const okFunc = /^(rgb|rgba|hsl|hsla|var)\(.+\)$/.test(val);
      const okNamed = /^[a-zA-Z]+$/.test(val) && val.length < 20;
      if (okHex || okFunc || okNamed) style.color = val;
    } else if (key === "size") {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 8 && n <= 72) style.fontSize = `${n}px`;
    } else if (key === "font") {
      if (val.length < 60 && /^[a-zA-Z0-9 ,\-"']+$/.test(val)) {
        const first = val.split(",")[0].trim().replace(/^["']|["']$/g, "");
        if (allowedFonts.has(first) || /^[a-zA-Z ]+$/.test(first)) style.fontFamily = val;
      }
    }
  }
  return style;
}

// Finds the index of the "{/span}" matching the "{span …}" that just ended
// at `from`, accounting for nested spans of the same kind.
function findSpanClose(text: string, from: number): number {
  const re = /\{span\b[^}]*\}|\{\/span\}/g;
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].startsWith("{span")) depth++;
    else {
      depth--;
      if (depth === 0) return m.index;
    }
  }
  return -1;
}

function parseInline(text: string, keyPrefix: string, mentionsAsBold: boolean): ReactNode[] {
  // У роли «игрок» карты ключей нет: /api/mentions/index закрыт ролевым
  // гейтом (services/playerAccess.ts), и без неё каждая ссылка выглядела бы
  // зачёркнутой с неправдой «такой записи нет» и мастерской кнопкой «убрать
  // все ссылки». Игроку подпись показывается обычной прозой — ровно так же,
  // как она читается вслух за столом.
  const inert = getCachedUser()?.role === "player";
  const nodes: ReactNode[] = [];
  let pos = 0;
  let key = 0;
  while (pos < text.length) {
    const rest = text.slice(pos);
    const m = TOKEN_RE.exec(rest);
    if (!m) {
      nodes.push(<span key={`${keyPrefix}-${key++}`}>{rest}</span>);
      break;
    }
    const idx = m.index;
    if (idx > 0) nodes.push(<span key={`${keyPrefix}-${key++}`}>{rest.slice(0, idx)}</span>);
    const [
      full,
      refType,
      refUid,
      refSource,
      refLabel,
      mType,
      mId,
      mLabel,
      linkLabel,
      linkUrl,
      spanAttrs,
      boldText,
      italicText,
    ] = m;

    if (refType) {
      // Подпись остаётся читаемой прозой в обоих случаях — «Мирт отправляет вас
      // в Синий переулок» читается одинаково; меняется только то, кликается
      // карточка или зачёркнута и объясняет, чего не хватает.
      // Глобально: клик по живой сущности открывает превью-модалку вместо
      // навигации (запрос владельца: «не переходим, а карточка»).
      const target = resolveMention(refType, refUid);
      nodes.push(
        mentionsAsBold ? (
          <strong key={`${keyPrefix}-${key++}`}>{refLabel}</strong>
        ) : inert ? (
          <span key={`${keyPrefix}-${key++}`}>{refLabel}</span>
        ) : target != null ? (
          <button
            key={`${keyPrefix}-${key++}`}
            type="button"
            className={`mention-link mention--${mentionTone(refType, target)}`}
            onClick={() => openMentionPreview(refType, target)}
          >
            {refLabel}
          </button>
        ) : (
          <DeadMention
            key={`${keyPrefix}-${key++}`}
            type={refType}
            uid={refUid}
            source={refSource}
            label={refLabel}
          />
        )
      );
      pos += idx + full.length;
    } else if (mType) {
      const id = Number(mId);
      nodes.push(
        mentionsAsBold ? (
          <strong key={`${keyPrefix}-${key++}`}>{mLabel}</strong>
        ) : inert ? (
          <span key={`${keyPrefix}-${key++}`}>{mLabel}</span>
        ) : (
          <button
            key={`${keyPrefix}-${key++}`}
            type="button"
            className={`mention-link mention--${mentionTone(mType, id)}`}
            onClick={() => openMentionPreview(mType, id)}
          >
            {mLabel}
          </button>
        )
      );
      pos += idx + full.length;
    } else if (linkUrl) {
      nodes.push(
        <a key={`${keyPrefix}-${key++}`} className="ext-link" href={linkUrl} target="_blank" rel="noreferrer">
          {linkLabel}
        </a>
      );
      pos += idx + full.length;
    } else if (spanAttrs !== undefined) {
      const openEnd = pos + idx + full.length;
      const closeIdx = findSpanClose(text, openEnd);
      if (closeIdx === -1) {
        nodes.push(<span key={`${keyPrefix}-${key++}`}>{full}</span>);
        pos = openEnd;
      } else {
        const inner = text.slice(openEnd, closeIdx);
        nodes.push(
          <span key={`${keyPrefix}-${key}`} style={parseSpanAttrs(spanAttrs)}>
            {parseInline(inner, `${keyPrefix}-${key}`, mentionsAsBold)}
          </span>
        );
        pos = closeIdx + "{/span}".length;
      }
      key++;
    } else if (full === "{quote}") {
      const openEnd = pos + idx + full.length;
      const closeIdx = text.indexOf("{/quote}", openEnd);
      if (closeIdx === -1) {
        nodes.push(<span key={`${keyPrefix}-${key++}`}>{full}</span>);
        pos = openEnd;
      } else {
        const inner = text.slice(openEnd, closeIdx);
        nodes.push(
          <span key={`${keyPrefix}-${key}`} className="rt-quote">
            {parseInline(inner, `${keyPrefix}-${key}`, mentionsAsBold)}
          </span>
        );
        pos = closeIdx + "{/quote}".length;
      }
      key++;
    } else if (boldText != null) {
      nodes.push(<strong key={`${keyPrefix}-${key++}`}>{boldText}</strong>);
      pos += idx + full.length;
    } else if (italicText != null) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{italicText}</em>);
      pos += idx + full.length;
    }
  }
  return nodes;
}

type Protected = { kind: "mention" | "quote" | "span"; text: string; attrs?: string };
const PROTECTED_RE = /\uE000(\d+)\uE001/g;

function protectLegacy(source: string): { source: string; protectedRuns: Protected[] } {
  const protectedRuns: Protected[] = [];
  const put = (run: Protected) => { protectedRuns.push(run); return `\uE000${protectedRuns.length - 1}\uE001`; };
  // Mask links before GFM sees the pipes inside [[type@uid|source|label]].
  let result = source.replace(ANY_MENTION_RE, (text) => put({ kind: "mention", text }));
  // Repeated innermost replacement also preserves nested legacy spans.
  const wrappers = /\{span([^}]*)\}((?:(?!\{(?:span\b|quote\})|\{\/(?:span|quote)\})[\s\S])*)\{\/span\}|\{quote\}((?:(?!\{(?:span\b|quote\})|\{\/(?:span|quote)\})[\s\S])*)\{\/quote\}/g;
  for (let i = 0; i < 32; i++) {
    const next = result.replace(wrappers, (_full, attrs: string | undefined, spanText: string | undefined, quoteText: string | undefined) =>
      put({ kind: attrs === undefined ? "quote" : "span", text: (attrs === undefined ? quoteText : spanText) ?? "", attrs }));
    if (next === result) break;
    result = next;
  }
  return { source: result, protectedRuns };
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    if (url.protocol === "mailto:") return url.href;
  } catch { /* Render an unsafe or malformed target as text. */ }
  return null;
}

function isRelativeAttachment(value: string): boolean {
  return !value.startsWith("/") && !value.startsWith("\\") && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("#");
}

function renderMarkdown(text: string, mentionsAsBold: boolean, resources: Map<string, LinkedResource> = new Map()): ReactNode {
  const prepared = protectLegacy(text);
  const options = { gfm: true, breaks: false };
  const inline = (tokens: Token[], prefix: string): ReactNode[] => tokens.map((token, index) => {
    const key = `${prefix}-${index}`;
    switch (token.type) {
      case "text": {
        const parts: ReactNode[] = [];
        let from = 0;
        for (const match of token.text.matchAll(PROTECTED_RE)) {
          if (match.index > from) parts.push(parseInline(token.text.slice(from, match.index), `${key}-t${from}`, mentionsAsBold));
          const run = prepared.protectedRuns[Number(match[1])];
          if (run?.kind === "mention") parts.push(parseInline(run.text, `${key}-m${match.index}`, mentionsAsBold));
          else if (run?.kind === "quote") parts.push(<span key={`${key}-q${match.index}`} className="rt-quote">{inline(Lexer.lexInline(run.text, options), `${key}-q`)}</span>);
          else if (run?.kind === "span") parts.push(<span key={`${key}-s${match.index}`} style={parseSpanAttrs(run.attrs ?? "")}>{inline(Lexer.lexInline(run.text, options), `${key}-s`)}</span>);
          from = match.index + match[0].length;
        }
        if (from < token.text.length) parts.push(parseInline(token.text.slice(from), `${key}-t${from}`, mentionsAsBold));
        return <span key={key}>{parts}</span>;
      }
      case "strong": return <strong key={key}>{inline(token.tokens ?? [], key)}</strong>;
      case "em": return <em key={key}>{inline(token.tokens ?? [], key)}</em>;
      case "del": return <del key={key}>{inline(token.tokens ?? [], key)}</del>;
      case "codespan": return <code key={key}>{token.text}</code>;
      case "escape": return <span key={key}>{token.text}</span>;
      case "br": return <br key={key} />;
      case "link": {
        const resourceUid = RESOURCE_URL_RE.exec(token.href)?.[1]?.toLowerCase();
        if (resourceUid) {
          const target = resources.get(resourceUid);
          const href = target && resourceTarget(target);
          return href ? <a key={key} className="ext-link" href={href}>{inline(token.tokens ?? [], key)}</a>
            : <span key={key} className="rt-md-missing-resource" title="Ресурс недоступен">{inline(token.tokens ?? [], key)} (Ресурс недоступен)</span>;
        }
        const href = safeUrl(token.href);
        return href ? <a key={key} className="ext-link" href={href} target="_blank" rel="noreferrer">{inline(token.tokens ?? [], key)}</a>
          : <span key={key} className={isRelativeAttachment(token.href) ? "rt-md-missing-resource" : undefined} title={isRelativeAttachment(token.href) ? "Прикрепите файл через редактор Markdown" : undefined}>{inline(token.tokens ?? [], key)}{isRelativeAttachment(token.href) ? " (Вложение не прикреплено)" : ""}</span>;
      }
      case "image": {
        const layout = parseImageLayout(token.text);
        const figure = (src: string) => layout.side || layout.width != null
          ? <span key={key} className={`rt-md-figure rt-md-figure--${layout.side ?? "center"}`}
              style={layout.width != null ? { width: `${layout.width}%` } : undefined}
              data-layout={[layout.side && SIDE_LABEL[layout.side], layout.width != null && `${layout.width}%`].filter(Boolean).join(" · ")}>
              <img src={src} alt={layout.alt} title={token.title ?? undefined} className="rt-md-image" />
            </span>
          : <img key={key} src={src} alt={layout.alt} title={token.title ?? undefined} className="rt-md-image" />;
        const resourceUid = RESOURCE_URL_RE.exec(token.href)?.[1]?.toLowerCase();
        if (resourceUid) {
          const target = resources.get(resourceUid);
          return target?.file_url && isImageResource(target)
            ? figure(target.file_url)
            : <span key={key} className="rt-md-missing-resource">{layout.alt || "Изображение"} (Ресурс недоступен)</span>;
        }
        const src = safeUrl(token.href);
        return src && !src.startsWith("mailto:") ? figure(src) : <span key={key} className={isRelativeAttachment(token.href) ? "rt-md-missing-resource" : undefined}>{layout.alt}{isRelativeAttachment(token.href) ? " (Вложение не прикреплено)" : ""}</span>;
      }
      case "html": return <span key={key}>{token.raw}</span>;
      default: return <span key={key}>{"text" in token ? String(token.text) : token.raw}</span>;
    }
  });
  const blocks = (tokens: Token[], prefix: string): ReactNode[] => tokens.map((token, index) => {
    const key = `${prefix}-${index}`;
    switch (token.type) {
      case "space": return null;
      case "checkbox": return null;
      case "paragraph": return <span key={key} className="rt-md-paragraph">{inline(token.tokens ?? [], key)}</span>;
      case "text": return <span key={key} className="rt-md-paragraph">{inline(token.tokens ?? Lexer.lexInline(token.text, options), key)}</span>;
      case "heading": return <span key={key} className={`rt-h rt-h${Math.min(token.depth, 3)}`}>{inline(token.tokens ?? [], key)}</span>;
      case "blockquote": return <span key={key} className="rt-quote rt-md-quote">{blocks(token.tokens ?? [], key)}</span>;
      case "code": return <pre key={key} className="rt-md-code"><code>{token.text}</code></pre>;
      case "hr": return <hr key={key} className="rt-md-rule" />;
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map((item, ii) => <li key={ii}>
          {item.task && <input type="checkbox" checked={!!item.checked} readOnly aria-label="Пункт списка" />}
          {blocks(item.tokens, `${key}-${ii}`)}
        </li>);
        return list.ordered ? <ol key={key} className="rt-ul" start={typeof list.start === "number" ? list.start : undefined}>{items}</ol>
          : <ul key={key} className="rt-ul">{items}</ul>;
      }
      case "table": return <div key={key} className="rt-table-wrap"><table className="rt-table">
        <thead><tr>{(token as Tokens.Table).header.map((cell, ci) => <th key={ci} style={{ textAlign: cell.align ?? undefined }}>{inline(cell.tokens, `${key}-h${ci}`)}</th>)}</tr></thead>
        <tbody>{(token as Tokens.Table).rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} style={{ textAlign: cell.align ?? undefined }}>{inline(cell.tokens, `${key}-r${ri}-${ci}`)}</td>)}</tr>)}</tbody>
      </table></div>;
      case "html": return <span key={key} className="rt-md-paragraph">{token.raw}</span>;
      default: return <span key={key}>{token.raw}</span>;
    }
  });
  return <>{blocks(marked.lexer(prepared.source, options), "md")}</>;
}

export function MentionText({ text, mentionsAsBold = false }: { text: string; mentionsAsBold?: boolean }) {
  // Карта ключей приезжает после первой отрисовки: без подписки на неё текст,
  // нарисованный раньше, так и остался бы с зачёркнутыми ссылками и без цвета.
  const indexVersion = useMentionIndex();
  const refs = useMemo(() => [...new Set([...text.matchAll(RESOURCE_URL_SCAN)].map(match => match[1].toLowerCase()))].sort(), [text]);
  const content = useMemo(() => renderMarkdown(text, mentionsAsBold), [text, mentionsAsBold, indexVersion]);
  return refs.length ? <ResourceMentionText text={text} mentionsAsBold={mentionsAsBold} refs={refs} /> : <>{content}</>;
}

function ResourceMentionText({ text, mentionsAsBold, refs }: { text: string; mentionsAsBold: boolean; refs: string[] }) {
  const indexVersion = useMentionIndex();
  const query = useResource<LinkedResource[]>(`/resources/resolve?uids=${refs.join(",")}`);
  const resources = useMemo(() => new Map((query.data ?? []).map(resource => [resource.uid.toLowerCase(), resource])), [query.data]);
  const content = useMemo(() => renderMarkdown(text, mentionsAsBold, resources), [text, mentionsAsBold, resources, indexVersion]);
  return <>{content}</>;
}
