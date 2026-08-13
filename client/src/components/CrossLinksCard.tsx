import { useState } from "react";
import { api } from "../api/client";

export interface CrossLinkProposal {
  ownerType: string;
  ownerId: number;
  ownerName: string;
  ownerLabel: string;
  field: string;
  fieldLabel: string;
  ref: string;
  targetName: string;
  matched: string;
  context: string;
  via: string;
  suggested: boolean;
  doubt?: string;
}

const proposalId = (p: CrossLinkProposal) =>
  `${p.ownerType}|${p.ownerId}|${p.field}|${p.ref}|${p.matched}`;

/**
 * «Перекрёстные ссылки» — проход по тексту, превращающий имена в кликабельные
 * меншены. Один и тот же экран для двух проходов: по сценам приключения (там
 * кандидаты берутся из связей самой сцены) и по всему сеттингу (там из всего
 * сеттинга, а точность держится на однозначности имени).
 *
 * Ничего не пишет сам: сомнительные находки видны и сняты заранее, но пять
 * мест, где «карта» повела на «Карту сокровищ», исправлять всё равно дороже,
 * чем один раз посмотреть список.
 */
export function CrossLinksCard({ base, help }: { base: string; help: string }) {
  const [proposals, setProposals] = useState<CrossLinkProposal[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  async function load() {
    setBusy(true);
    setDone("");
    try {
      const found = await api.get<CrossLinkProposal[]>(`${base}/cross-links`);
      setProposals(found);
      setChosen(Object.fromEntries(found.map((p) => [proposalId(p), p.suggested])));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!proposals) return;
    setBusy(true);
    try {
      const picked = proposals.filter((p) => chosen[proposalId(p)]);
      const result = await api.post<{ written: number }>(`${base}/cross-links`, {
        chosen: picked.map((p) => ({
          ownerType: p.ownerType,
          ownerId: p.ownerId,
          field: p.field,
          ref: p.ref,
          matched: p.matched,
        })),
      });
      setDone(`Расставлено ссылок: ${result.written}.`);
      setProposals(null);
    } finally {
      setBusy(false);
    }
  }

  async function strip() {
    if (!confirm("Снять все перекрёстные ссылки? Подписи останутся, ссылки уйдут.")) return;
    setBusy(true);
    try {
      const result = await api.del<{ removed: number }>(`${base}/cross-links`);
      setDone(`Снято ссылок: ${result.removed}.`);
      setProposals(null);
    } finally {
      setBusy(false);
    }
  }

  // Сгруппировано по цели, а не по текстам: решение человек принимает про
  // сущность целиком — «переулок» не значит «Синий переулок» нигде, а «Мирт»
  // значит «Мирт» везде.
  const groups = new Map<string, CrossLinkProposal[]>();
  for (const p of proposals ?? []) {
    const list = groups.get(p.ref) ?? [];
    list.push(p);
    groups.set(p.ref, list);
  }
  const picked = (proposals ?? []).filter((p) => chosen[proposalId(p)]).length;

  function toggleGroup(list: CrossLinkProposal[], on: boolean) {
    setChosen((prev) => {
      const next = { ...prev };
      for (const p of list) next[proposalId(p)] = on;
      return next;
    });
  }

  return (
    <details className="card">
      <summary className="sb-section" style={{ margin: 0 }}>
        Перекрёстные ссылки
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <span className="muted">{help}</span>
        <div className="row">
          <button disabled={busy} onClick={() => void load()}>
            {proposals ? "Искать заново" : "Найти ссылки"}
          </button>
          {proposals && proposals.length > 0 && (
            <button className="primary" disabled={busy || !picked} onClick={() => void apply()}>
              Расставить отмеченные ({picked})
            </button>
          )}
          <button className="danger" disabled={busy} onClick={() => void strip()}>
            Снять все
          </button>
        </div>
        {done && <div className="muted">{done}</div>}
        {proposals?.length === 0 && (
          <div className="muted">Ничего нового не нашлось — всё уже размечено.</div>
        )}
        {[...groups.entries()].map(([ref, list]) => (
          <div key={ref} className="stack" style={{ gap: 4 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>
                {list[0].targetName}{" "}
                <span className="muted">
                  — {list.length} · по «{list[0].via}»
                  {list[0].doubt ? ` · ${list[0].doubt}` : ""}
                </span>
              </strong>
              <div className="row">
                <button onClick={() => toggleGroup(list, true)}>Все</button>
                <button onClick={() => toggleGroup(list, false)}>Никого</button>
              </div>
            </div>
            {list.map((p) => (
              <label key={proposalId(p)} className="row" style={{ gap: 6, alignItems: "start" }}>
                <input
                  type="checkbox"
                  checked={!!chosen[proposalId(p)]}
                  onChange={(e) =>
                    setChosen((prev) => ({ ...prev, [proposalId(p)]: e.target.checked }))
                  }
                />
                <span>
                  <span className="muted">
                    {p.ownerLabel} «{p.ownerName}» · {p.fieldLabel}:{" "}
                  </span>
                  {p.context.split(p.matched).flatMap((part, i, all) => [
                    <span key={`t${i}`}>{part}</span>,
                    i < all.length - 1 ? <strong key={`m${i}`}>{p.matched}</strong> : null,
                  ])}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
