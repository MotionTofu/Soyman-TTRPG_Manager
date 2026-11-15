import { useLayoutEffect, useRef, useState } from "react";
import { useBag } from "../bag";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import { RuleArticleContents } from "./RuleArticleModal";

export function BagRulesControl() {
  const { items } = useBag();
  const rules = items.filter((item) => item.rule).sort((a, b) => Number(!!b.rule?.pinned) - Number(!!a.rule?.pinned));
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = rules.find((rule) => rule.id === selectedId);
  const opener = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const previousRow = useRef<{ id: number; scrollTop: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || selected || !previousRow.current || !listRef.current) return;
    const { id, scrollTop } = previousRow.current;
    previousRow.current = null;
    const list = listRef.current;
    list.scrollTop = scrollTop;
    (list.querySelector<HTMLButtonElement>(`[data-rule-id="${id}"]`) ?? list.querySelector("button"))?.focus({ preventScroll: true });
  }, [open, selected]);

  function close() {
    setOpen(false);
    setSelectedId(null);
    previousRow.current = null;
  }

  function backToList() {
    setSelectedId(null);
  }

  return (
    <div className="bag-rules-access">
      <button ref={opener} type="button" className="d-btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <NavIcon name="bag" /> <span>Правила из мешка</span>
        <span className="bag-rules-count">{rules.length}</span>
      </button>
      {open && (
        <Modal
          ariaLabel={selected?.title ?? "Правила из мешка"}
          className={`bag-rules-modal${selected ? " rule-article-modal" : ""}`}
          onClose={close}
          onEscape={selected ? backToList : undefined}
          returnFocusTo={opener}
          autoFocus={false}
        >
          {selected ? (
            <RuleArticleContents key={selected.id} source={{ item: selected }} onBack={backToList} />
          ) : (
            <>
              <h2>Правила из мешка</h2>
              {rules.length === 0 ? <p className="muted">Добавьте статью из «Напомню!» или справочника.</p> : (
                <ul ref={listRef} className="bag-rules-list">
                  {rules.map((rule) => (
                    <li key={rule.id}>
                      <button type="button" className="bag-rule-row" data-rule-id={rule.id} onClick={() => {
                        previousRow.current = { id: rule.id, scrollTop: listRef.current?.scrollTop ?? 0 };
                        setSelectedId(rule.id);
                      }}>
                        <span>
                          <strong>{rule.title}</strong>
                          {rule.rule?.pinned && <small>Закреплено</small>}
                        </span>
                        <span aria-hidden="true">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
