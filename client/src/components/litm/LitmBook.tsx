import type { ReactNode } from "react";
import "./litm-book.css";
import { MIGHT_NAMES, NAMED_CONSEQUENCES, splitConsequence, type LitmMight } from "./litmBookText";

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

/** Разметка книги → вид «сказочной книги»: `*x-3*` — статус с уровнем,
 *  `*x*` — тег, `**Заблокировано**` — стрелка последствия, `**ИМЯ**` — капитель. */
export function LitmRich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      out.push(NAMED_CONSEQUENCES.has(m[1])
        ? <span key={at} className="lb-cq">{m[1]}</span>
        : <b key={at} className="lb-ref">{m[1]}</b>);
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
