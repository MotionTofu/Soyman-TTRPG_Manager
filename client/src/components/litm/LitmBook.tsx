import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "./litm-book.css";
import { grimMark } from "./litmGrimoire";
import { MIGHT_NAMES, namedConsequence, splitConsequence, type LitmMight } from "./litmBookText";

/** Общие кусочки «сказочной книги» LitM: теги, статусы, ступени, роли, рейтинг
 *  и разбор разметки книги (доска Litm-Language, обзор подачи Q13). */

export function Tag({ children, weak }: { children: ReactNode; weak?: boolean }) {
  return <span className={weak ? "lb-tw" : "lb-tg"}>{children}</span>;
}

export function Status({ name, tier }: { name: string; tier?: string | number }) {
  return <span className="lb-st">{name}{tier !== undefined && tier !== "" && <b>{tier}</b>}</span>;
}

export function MightMark({ might, label }: { might: LitmMight; label?: string }) {
  return <span className={`lb-mt lb-mt--${might}`}>{label ?? MIGHT_NAMES[might]}</span>;
}

export function Roles({ roles }: { roles: string[] }) {
  return <span>{roles.map((r) => <span key={r} className="lb-role">{r}</span>)}</span>;
}

export function Rating({ value }: { value: number }) {
  return (
    <span className="lb-rt" role="img" aria-label={`Рейтинг ${value} из 5`} title={`Рейтинг ${value} из 5`}>
      {[0, 1, 2, 3, 4].map((k) => <i key={k} className={k < value ? "on" : ""} />)}
    </span>
  );
}

const TOKEN = /\*\*([^*]+)\*\*|(?<!\*)\*([^*\n]+)\*(?!\*)/g;
const GRIM_REF = /«([^»]+)»\s*\(с\.\s*(\d+)\)/g;
const CORE_PAGE = /^,\s*кн\.\s*I,\s*с\.\s*(\d+)\b/i;

/** Ссылки Гримуара: статья по «Названию» (с. N), правило корника по **Имени**. */
export interface GrimLinks {
  article: (name: string, page: number) => string | null;
  rule: (name: string, page?: string) => string | null;
}

/** Разметка книги → вид «сказочной книги»: `*x-3*` — статус с уровнем,
 *  `*x*` — тег, `**Заблокировано**` — стрелка последствия, `**ИМЯ**` — капитель.
 *  С `grim` — правила Гримуара: статус или тег по месту, ссылки на статьи и правила. */
export function LitmRich({ text, grim }: { text: string; grim?: GrimLinks }) {
  if (grim) {
    const parts: ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(GRIM_REF)) {
      const at = m.index ?? 0;
      const href = grim.article(m[1], Number(m[2]));
      if (!href) continue;
      if (at > last) parts.push(<RichRun key={last} text={text.slice(last, at)} grim={grim} />);
      parts.push(<Link key={at} className="lb-link" to={href}>{m[1]}, с. {m[2]}</Link>);
      last = at + m[0].length;
    }
    if (!parts.length) return <RichRun text={text} grim={grim} />;
    if (last < text.length) parts.push(<RichRun key={last} text={text.slice(last)} grim={grim} />);
    return <>{parts}</>;
  }
  return <RichRun text={text} />;
}

function RichRun({ text, grim }: { text: string; grim?: GrimLinks }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      const consequence = namedConsequence(m[1]);
      const corePage = CORE_PAGE.exec(text.slice(at + m[0].length))?.[1];
      const rule = grim && !consequence ? grim.rule(m[1], corePage ? `A${corePage}` : undefined) : null;
      out.push(consequence
        ? <span key={at} className="lb-cq">{consequence.name}{m[1].endsWith(":") ? ":" : ""}</span>
        : rule ? <Link key={at} className="lb-ref lb-link" to={rule}>{m[1]}</Link>
        : <b key={at} className="lb-ref">{m[1]}</b>);
    } else if (/^[A-Z][a-z]/.test(m[2])) {
      out.push(<i key={at}>{m[2]}</i>); // *Legend in the Mist* — название, не тег
    } else if (grim) {
      const mark = grimMark(m[2], text.slice(Math.max(0, at - 24), at));
      out.push(mark.kind === "tag" ? <Tag key={at}>{mark.name}</Tag> : <Status key={at} name={mark.name} tier={mark.tier} />);
    } else {
      const tier = /^(.*)-(\d+)$/.exec(m[2]);
      // «снять 2 уровня с *ублажён*», «сбросить *сбежал*», «статус *спрятан*» — статус без уровня.
      const statusRef = /(уровн[а-я]* со?|сбросить|статус[а-я]*)\s*$/i.test(text.slice(Math.max(0, at - 24), at));
      out.push(tier ? <Status key={at} name={tier[1]} tier={tier[2]} />
        : statusRef ? <Status key={at} name={m[2]} /> : <Tag key={at}>{m[2]}</Tag>);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function Consequence({ text }: { text: string }) {
  const { lead, effect } = splitConsequence(text);
  return <><LitmRich text={lead} />{effect !== null && <> <span className="lb-eff"><LitmRich text={effect} /></span></>}</>;
}
