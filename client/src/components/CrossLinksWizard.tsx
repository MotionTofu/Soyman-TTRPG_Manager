import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

// Расстановка ссылок в текстах — шагами, по одному типу цели за раз.
//
// Шаги нужны не для навигации. Типы требуют разной строгости: у локаций и
// личностей есть синонимы и оригинальные написания, у записей компендиума нет
// ничего, кроме названия, зато их почти две тысячи. Одним списком на четыреста
// находок человек не работает — он жмёт «отметить всё». Сорок находок «личности
// в текстах сеттинга» он проверит.
//
// Каждый шаг применяется сам по себе. Так проще не только пользователю:
// правило «не лезть внутрь уже размеченного» смотрит на фактический текст, и
// поздние шаги видят разметку ранних, а брошенный на середине визард не теряет
// проверенного.

type Tier = "exact" | "likely" | "doubtful";

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
  tier: Tier;
  doubt?: string;
}

interface Step {
  key: string;
  label: string;
  owner: "setting" | "system";
}

interface Source {
  kind: "setting" | "system";
  id: number;
  name: string;
  checked: boolean;
}

const proposalId = (p: CrossLinkProposal) =>
  `${p.ownerType}|${p.ownerId}|${p.field}|${p.ref}|${p.matched}`;

// Цвет — быстрый сигнал, подпись — ответ на «почему». Одного цвета мало:
// серый в этом интерфейсе уже значит «выключено», а полагаться только на
// оттенок нельзя при любых особенностях цветовосприятия.
const TIERS: { key: Tier; label: string; className: string }[] = [
  { key: "exact", label: "Точные", className: "xl-tier-exact" },
  { key: "likely", label: "Вероятные", className: "xl-tier-likely" },
  { key: "doubtful", label: "Сомнительные", className: "xl-tier-doubtful" },
];

export function CrossLinksWizard({
  ownerKind,
  ownerId,
  help,
}: {
  ownerKind: "setting" | "adventure" | "campaign" | "system";
  ownerId: number;
  help: string;
}) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [stepKey, setStepKey] = useState("");
  const [proposals, setProposals] = useState<CrossLinkProposal[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");
  /** Что уже прошли: по галочкам во вкладках видно, где человек остановился. */
  const [visited, setVisited] = useState<Record<string, number>>({});

  useEffect(() => {
    api
      .get<{ steps: Step[]; sources: Source[] }>(
        `/cross-links/scope?ownerKind=${ownerKind}&ownerId=${ownerId}`
      )
      .then((r) => {
        setSteps(r.steps);
        setSources(r.sources);
        setStepKey(r.steps[0]?.key ?? "");
      })
      .catch(() => setSteps([]));
  }, [ownerKind, ownerId]);

  const activeSources = useMemo(() => sources.filter((s) => s.checked), [sources]);
  const sourceParam = activeSources.map((s) => `${s.kind}:${s.id}`).join(",");
  const step = steps.find((s) => s.key === stepKey);
  // Шаг по записям компендиума бессмыслен без хотя бы одной системы в области.
  const stepUsable = !!step && activeSources.some((s) => s.kind === step.owner);

  function goTo(key: string) {
    setStepKey(key);
    setProposals(null);
    setChosen({});
    setDone("");
  }

  async function search() {
    setBusy("search");
    setDone("");
    try {
      const found = await api.get<CrossLinkProposal[]>(
        `/cross-links/plan?ownerKind=${ownerKind}&ownerId=${ownerId}&targetType=${stepKey}&sources=${encodeURIComponent(sourceParam)}`,
        { timeoutMs: 30000 }
      );
      setProposals(found);
      // Галочки только на точных: визард охватывает и компендиум, где
      // «вероятных» будут сотни, и отмечать их заранее значит просить человека
      // снимать галочки вместо того, чтобы ставить.
      setChosen(Object.fromEntries(found.map((p) => [proposalId(p), p.tier === "exact"])));
    } finally {
      setBusy("");
    }
  }

  async function apply() {
    if (!proposals) return;
    setBusy("apply");
    try {
      const r = await api.post<{ written: number }>(
        `/cross-links/apply?ownerKind=${ownerKind}&ownerId=${ownerId}&targetType=${stepKey}&sources=${encodeURIComponent(sourceParam)}`,
        { chosen: proposals.filter((p) => chosen[proposalId(p)]) },
        { timeoutMs: 30000 }
      );
      setDone(`Расставлено ссылок: ${r.written}.`);
      setVisited((v) => ({ ...v, [stepKey]: (v[stepKey] ?? 0) + r.written }));
      setProposals(null);
      setChosen({});
    } finally {
      setBusy("");
    }
  }

  async function strip() {
    if (!confirm("Снять все расставленные ссылки в текстах? Подписи останутся.")) return;
    setBusy("strip");
    try {
      const r = await api.del<{ removed: number }>(
        `/cross-links?ownerKind=${ownerKind}&ownerId=${ownerId}`
      );
      setDone(`Снято ссылок: ${r.removed}.`);
      setProposals(null);
    } finally {
      setBusy("");
    }
  }

  const picked = proposals?.filter((p) => chosen[proposalId(p)]).length ?? 0;

  return (
    <details className="card res-group">
      <summary className="res-group__band">
        <span className="res-group__title">Автолинковка упоминаний</span> <span className="badge tag" style={{ marginLeft: 8, fontSize: "var(--fs-micro)" }}>beta</span>
      </summary>
      <div className="res-group__body" style={{ padding: 12 }}>
      <div className="stack" style={{ marginTop: 8 }}>
        <span className="muted">{help}</span>

        <div className="row xl-tabs">
          {steps.map((s) => (
            <button
              key={s.key}
              className={s.key === stepKey ? "primary" : ""}
              onClick={() => goTo(s.key)}
            >
              {s.label}
              {visited[s.key] ? ` · ${visited[s.key]}` : ""}
            </button>
          ))}
        </div>

        <div className="stack" style={{ gap: 4 }}>
          <span className="muted">Где искать:</span>
          <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
            {sources.map((s) => (
              <label key={`${s.kind}:${s.id}`} className="row" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={s.checked}
                  onChange={(e) =>
                    setSources((prev) =>
                      prev.map((x) =>
                        x.kind === s.kind && x.id === s.id ? { ...x, checked: e.target.checked } : x
                      )
                    )
                  }
                />
                {s.name}
                <span className="muted">{s.kind === "system" ? "система" : "сеттинг"}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="row">
          <button className="primary" disabled={!!busy || !stepUsable} onClick={() => void search()}>
            {busy === "search" ? "Ищу…" : "Искать"}
          </button>
          {proposals && (
            <button disabled={!!busy} onClick={() => goTo(stepKey)}>
              Отменить шаг
            </button>
          )}
          <button
            disabled={!!busy}
            onClick={() => {
              const i = steps.findIndex((s) => s.key === stepKey);
              goTo(steps[Math.min(i + 1, steps.length - 1)]?.key ?? stepKey);
            }}
          >
            Пропустить шаг
          </button>
          <button className="danger" disabled={!!busy} onClick={() => void strip()}>
            Снять все
          </button>
        </div>

        {!stepUsable && step && (
          <div className="muted">
            Для шага «{step.label}» нужна отмеченная {step.owner === "system" ? "система" : "сеттинг"}.
          </div>
        )}
        {done && <div className="muted">{done}</div>}
        {proposals?.length === 0 && (
          <div className="muted">Ничего нового не нашлось — всё уже размечено.</div>
        )}

        {proposals && proposals.length > 0 && (
          <>
            <div className="row">
              <button className="primary" disabled={!!busy || !picked} onClick={() => void apply()}>
                Расставить отмеченные ({picked})
              </button>
            </div>
            {TIERS.map(({ key, label, className }) => {
              const list = proposals.filter((p) => p.tier === key);
              if (!list.length) return null;
              const doubts = [...new Set(list.map((p) => p.doubt).filter(Boolean))];
              return (
                <div key={key} className={`stack xl-tier ${className}`} style={{ gap: 6 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>
                      {label} · {list.length}
                      {doubts.length > 0 && (
                        <span className="muted"> · {doubts.slice(0, 2).join("; ")}</span>
                      )}
                    </strong>
                    <div className="row">
                      <button
                        onClick={() =>
                          setChosen((prev) => ({
                            ...prev,
                            ...Object.fromEntries(list.map((p) => [proposalId(p), true])),
                          }))
                        }
                      >
                        Все
                      </button>
                      <button
                        onClick={() =>
                          setChosen((prev) => ({
                            ...prev,
                            ...Object.fromEntries(list.map((p) => [proposalId(p), false])),
                          }))
                        }
                      >
                        Никого
                      </button>
                    </div>
                  </div>
                  {list.map((p) => (
                    <label
                      key={proposalId(p)}
                      className="row"
                      style={{ gap: 6, alignItems: "start" }}
                    >
                      <input
                        type="checkbox"
                        checked={!!chosen[proposalId(p)]}
                        onChange={(e) =>
                          setChosen((prev) => ({ ...prev, [proposalId(p)]: e.target.checked }))
                        }
                      />
                      <span>
                        <strong>{p.targetName}</strong>{" "}
                        <span className="muted">
                          ← «{p.matched}» · {p.ownerLabel} «{p.ownerName}» · {p.fieldLabel} · по «
                          {p.via}»
                        </span>
                        <div className="muted">{p.context}</div>
                      </span>
                    </label>
                  ))}
                </div>
              );
            })}
            <div className="row">
              <button className="primary" disabled={!!busy || !picked} onClick={() => void apply()}>
                Расставить отмеченные ({picked})
              </button>
            </div>
          </>
        )}
      </div>
      </div>
    </details>
  );
}
