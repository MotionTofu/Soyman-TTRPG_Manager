import { MentionText } from "../mentions/MentionText";
import type { CompendiumEntry } from "../../types";
import type { WorkbenchBlock } from "../../workbench";

// Содержимое блока на листе. Одно и то же на экране, в замере и в печати
// (В14): что видно, то и выйдет на бумагу.

function host(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function sourceLine(block: WorkbenchBlock): string {
  const date = block.captured_at ? new Date(block.captured_at).toLocaleDateString("ru-RU") : "";
  return [block.url ? host(block.url) : "", block.page_title ?? "", date].filter(Boolean).join(" · ");
}

function cardMeta(entry: CompendiumEntry): string {
  const d = entry.data as Record<string, unknown>;
  const name = (v: unknown) => (v && typeof v === "object" && "name" in v ? String((v as { name: unknown }).name) : "");
  if (entry.kind === "spell") {
    const level = entry.level == null ? "" : entry.level === 0 ? "Заговор" : `${entry.level} круг`;
    return [level, name(d.school), d.ritual ? "ритуал" : "", d.concentration ? "концентрация" : ""].filter(Boolean).join(" · ");
  }
  if (entry.kind === "monster" && Array.isArray(d.roles)) {
    const rating = typeof d.rating === "number" ? `рейтинг ${"●".repeat(d.rating)}` : "";
    return ["Вызов", (d.roles as string[]).join(", "), rating].filter(Boolean).join(" · ");
  }
  if (entry.kind === "monster") return [d.size, name(d.creature_type)].filter(Boolean).join(" · ");
  return "";
}

function cardLines(entry: CompendiumEntry): [string, string][] {
  const d = entry.data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (entry.kind === "spell") {
    return ([["Время", str(d.casting_timing)], ["Дистанция", str(d.range)], ["Длительность", str(d.duration)]] as [string, string][])
      .filter(([, v]) => v);
  }
  if (entry.kind === "monster" && str(d.location)) return [["Где", str(d.location)]];
  return [];
}

export function BlockContent({ block, entry }: { block: WorkbenchBlock; entry?: CompendiumEntry }) {
  if (block.kind === "card") {
    if (!entry) return null;
    if (block.card_mode === "description") {
      return <div className="wb-md"><h3>{entry.name}</h3><MentionText text={entry.description || ""} mentionsAsBold /></div>;
    }
    const meta = cardMeta(entry);
    return (
      <div className="wb-card">
        <div className="wb-card__head"><b>{entry.name}</b>{meta && <small>{meta}</small>}</div>
        {cardLines(entry).map(([k, v]) => <p key={k} className="wb-card__line"><i>{k}</i> {v}</p>)}
        {entry.description && <div className="wb-md"><MentionText text={entry.description} mentionsAsBold /></div>}
      </div>
    );
  }
  const empty = !block.title.trim() && !block.text.trim();
  return (
    <div className="wb-md">
      {block.title.trim() && <h3>{block.title}</h3>}
      {block.text.trim() && <MentionText text={block.text} mentionsAsBold />}
      {empty && <p className="wb-placeholder">Свой текст — «Править», чтобы написать.</p>}
      {block.kind === "fragment" && !!block.show_source && <div className="wb-src">{sourceLine(block)}</div>}
    </div>
  );
}
