import type { ReactNode } from "react";
import { Lexer, type Token, type Tokens } from "marked";
import { MentionText } from "../mentions/MentionText";

const TERMS = /\[\[[^\]\n]+\]\]|\b(?:strong hit|mixed hit|miss|[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d+)\b/gi;
const OUTCOME = /^(?:strong hit|mixed hit|miss)$/i;
const STATUS = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d+$/i;

function plain(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(TERMS)) {
    if (match.index > from) nodes.push(text.slice(from, match.index));
    nodes.push(match[0].startsWith("[[")
      ? <MentionText key={`${key}-${match.index}`} text={match[0]} />
      : <code key={`${key}-${match.index}`} className={OUTCOME.test(match[0]) ? "oc-outcome" : "oc-status"}>{match[0]}</code>);
    from = match.index + match[0].length;
  }
  if (from < text.length) nodes.push(text.slice(from));
  return nodes;
}

function inline(tokens: Token[], key: string): ReactNode[] {
  return tokens.map((token, i) => {
    const id = `${key}-${i}`;
    switch (token.type) {
      case "text": return <span key={id}>{plain(token.text, id)}</span>;
      case "strong": return <strong key={id}>{inline(token.tokens ?? [], id)}</strong>;
      case "em": return <em key={id}>{inline(token.tokens ?? [], id)}</em>;
      case "del": return <del key={id}>{inline(token.tokens ?? [], id)}</del>;
      case "codespan": return <code key={id} className={OUTCOME.test(token.text) ? "oc-outcome" : STATUS.test(token.text) ? "oc-status" : undefined}>{token.text}</code>;
      case "escape": return <span key={id}>{token.text}</span>;
      case "br": return <br key={id} />;
      default: return <MentionText key={id} text={token.raw} />;
    }
  });
}

function blocks(tokens: Token[], key: string): ReactNode[] {
  return tokens.map((token, i) => {
    const id = `${key}-${i}`;
    switch (token.type) {
      case "space": return null;
      case "paragraph":
      case "text": return <p key={id}>{inline(token.tokens ?? Lexer.lexInline(token.text), id)}</p>;
      case "heading": return <h4 key={id}>{inline(token.tokens ?? [], id)}</h4>;
      case "list": {
        const list = token as Tokens.List;
        const Tag = list.ordered ? "ol" : "ul";
        return <Tag key={id}>{list.items.map((item, n) => <li key={n}>{blocks(item.tokens ?? [], `${id}-${n}`)}</li>)}</Tag>;
      }
      case "blockquote": return <blockquote key={id}>{blocks(token.tokens ?? [], id)}</blockquote>;
      default: return <MentionText key={id} text={token.raw} />;
    }
  });
}

/** Keeps Markdown structure and native UID links; color only carries game-term semantics. */
export function OtherscapeText({ text }: { text: string }) {
  return <div className="oc-text">{ /\{(?:span\b|quote\})/.test(text)
    ? <MentionText text={text} />
    : blocks(Lexer.lex(text, { gfm: true }), "oc") }</div>;
}
