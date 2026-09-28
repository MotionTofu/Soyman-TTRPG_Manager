import { useState } from "react";
import { readOnce } from "../data/imperative";
import { errorText, useAfterWrite, write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { ProposalTiers } from "./CrossLinksWizard";
import { proposalId, type CrossLinkProposal } from "./crossLinkProposal";
import { Modal } from "./Modal";

// «Проставить упоминания» в ленте сессии (гриллинг 2026-09-28, Q6): после игры
// система ищет в сообщениях всех, кто есть в кампании, её сеттинге и системе,
// и показывает находки списком. Точные отмечены, вероятные и сомнительные —
// нет: «Щит» и «Свет» почти всегда значат себя, а не заклинание.

export function SessionMentionsButton({ sessionId }: { sessionId: number }) {
  const afterWrite = useAfterWrite();
  const [proposals, setProposals] = useState<CrossLinkProposal[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const query = `ownerKind=session&ownerId=${sessionId}`;

  async function open() {
    setBusy(true);
    try {
      const found = await readOnce<CrossLinkProposal[]>(`/cross-links/plan-all?${query}`, { timeoutMs: 30000 });
      setProposals(found);
      setChosen(Object.fromEntries(found.map((p) => [proposalId(p), p.tier === "exact"])));
    } catch (e) {
      showSaveError(`Поиск не удался: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!proposals) return;
    setBusy(true);
    try {
      await write.post(
        `/cross-links/apply-all?${query}`,
        { chosen: proposals.filter((p) => chosen[proposalId(p)]) },
        { timeoutMs: 30000 }
      );
      setProposals(null);
      // Ссылки легли в текст ленты и в связи сессии, а «Упоминания» задетых
      // сущностей — на их страницах: перечитать открытое.
      afterWrite([]);
    } catch (e) {
      showSaveError(`Упоминания не проставились: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const picked = proposals?.filter((p) => chosen[proposalId(p)]).length ?? 0;

  return (
    <>
      <button type="button" className="comp-mini" disabled={busy} onClick={() => void open()}>
        {busy && !proposals ? "Ищу…" : "Проставить упоминания"}
      </button>
      {proposals && (
        <Modal onClose={() => setProposals(null)} wide ariaLabel="Проставить упоминания">
          <div className="stack">
            <h3 className="session-mentions__title">Проставить упоминания</h3>
            {proposals.length === 0 ? (
              <span className="muted">Новых упоминаний не нашлось — всё уже размечено.</span>
            ) : (
              <ProposalTiers proposals={proposals} chosen={chosen} setChosen={setChosen} />
            )}
            <div className="row">
              {proposals.length > 0 && (
                <button className="primary" disabled={busy || !picked} onClick={() => void apply()}>
                  Проставить отмеченные ({picked})
                </button>
              )}
              <button onClick={() => setProposals(null)}>{proposals.length ? "Отмена" : "Закрыть"}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
