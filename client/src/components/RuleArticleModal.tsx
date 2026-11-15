import { useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { addToBag, setBagRulePinned, useBag, type BagItem } from "../bag";
import { useEntity } from "../data/hooks";
import { DETAIL_ROUTES } from "../entityTypes";
import type { CompendiumEntry } from "../types";
import { LoadErrorCard } from "./Loadable";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import { MentionText } from "./mentions/MentionText";
import "./rule-article.css";

type Article = Pick<CompendiumEntry, "id" | "name" | "description">;
type Source = { article: Article; storageId: string | undefined } | { item: BagItem };

export function RuleArticleModal({ source, onClose, returnFocusTo }: {
  source: Source;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  return (
    <Modal
      ariaLabel={"article" in source ? source.article.name : source.item.title}
      className="rule-article-modal"
      autoFocus={false}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
    >
      <RuleArticleContents source={source} />
    </Modal>
  );
}

export function RuleArticleContents({ source, onBack }: { source: Source; onBack?: () => void }) {
  const { items, storageId } = useBag();
  const fromHome = "article" in source;
  const item = "item" in source ? source.item : null;
  const scoped = !item?.rule || item.rule.storageId === storageId;
  const result = useEntity<CompendiumEntry>("compendium_entry", scoped ? item?.id : null);
  const [message, setMessage] = useState<string | null>(null);
  const article = fromHome ? source.article : result.data;
  const title = article?.name ?? item?.title ?? "Статья";
  const sameEntry = !item || item.rule || (result.data
    && item.title === result.data.name
    && (item.system_id == null || item.system_id === result.data.system_id)
    && (item.section_id == null || item.section_id === result.data.section_id));
  const saved = items.find((entry) => entry.type === "compendium_entry"
    && entry.id === article?.id && entry.rule?.storageId === storageId && entry.rule);
  const pinned = Boolean(saved?.rule?.pinned);
  const canAdd = fromHome && Boolean(storageId && source.storageId === storageId);

  function addArticle() {
    if (!article || !storageId || !canAdd || saved) return;
    try {
      const outcome = addToBag({ type: "compendium_entry", id: article.id, title: article.name, rule: { storageId } });
      setMessage(outcome === "full" ? "Мешок полон." : outcome === "invalid" ? "Не удалось добавить статью." : null);
    } catch {
      setMessage("Не удалось сохранить статью в мешке.");
    }
  }

  function togglePin() {
    const entry = saved ?? item;
    if (!entry) return;
    try {
      setMessage(setBagRulePinned(entry, !pinned) ? null : "Статья больше недоступна в мешке.");
    } catch {
      setMessage("Не удалось сохранить закрепление.");
    }
  }

  return (
    <>
      <h2>{title}</h2>
      {onBack && (
        <div className="rule-article-nav">
          <button type="button" className="d-btn d-btn--quiet" onClick={onBack} autoFocus>
            <span aria-hidden="true">‹</span> К списку
          </button>
        </div>
      )}
      <div className="reading-text" tabIndex={0}>
        {result.loading ? <p role="status">Загрузка статьи…</p>
          : result.error ? <LoadErrorCard message="Не удалось открыть статью." onRetry={result.reload} />
          : !scoped || !sameEntry || !article ? <p>Статья недоступна в этом хранилище.</p>
          : <MentionText text={article.description} />}
      </div>
      {article && scoped && sameEntry && !result.error && (
        <footer className="row modal-footer rule-article-actions">
          {message && <p className="rule-article-message" role="status">{message}</p>}
          {fromHome && (
            <button type="button" className="d-btn" onClick={addArticle}
              disabled={!canAdd} aria-disabled={Boolean(saved) || !canAdd} title={!canAdd ? "Хранилище ещё не определено" : undefined}>
              <NavIcon name="bag" /> {saved ? "В мешке" : "В мешок"}
            </button>
          )}
          {item && !onBack && storageId && (
            <button type="button" className="d-btn" onClick={togglePin}>{pinned ? "Открепить" : "Закрепить"}</button>
          )}
          <Link className="d-btn" to={`${DETAIL_ROUTES.compendium_entry}/${article.id}`}
            target={onBack ? "_blank" : undefined} rel={onBack ? "noreferrer" : undefined}>
            Открыть в справочнике <span aria-hidden="true">›</span>
          </Link>
        </footer>
      )}
    </>
  );
}
