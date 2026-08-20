import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { EmptyState } from "./EmptyState";
import { EntityPreviewModal } from "./EntityPreviewModal";
import { MentionText } from "./mentions/MentionText";
import { SectionHeading } from "./SectionHeading";

interface RandomArticle {
  id: number;
  name: string;
  description: string;
  /** Система · Справочник · группа (· подгруппа) — см. randomArticle.ts. */
  path: string[];
}

// Блок «Напомню!»: случайная статья из справочника любой системы. Статья
// меняется при каждом заходе на главную — предыдущая передаётся серверу,
// чтобы та же запись не выпала дважды подряд и блок не выглядел зависшим.
const LAST_SHOWN_KEY = "homeArticleLastId";

export function HomeArticleCard() {
  const [article, setArticle] = useState<RandomArticle | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const last = sessionStorage.getItem(LAST_SHOWN_KEY);
    api
      .get<RandomArticle | null>(`/random-article${last ? `?exclude=${last}` : ""}`)
      .then((next) => {
        setArticle(next);
        if (next) sessionStorage.setItem(LAST_SHOWN_KEY, String(next.id));
      })
      .catch(() => setArticle(null));
  }, []);

  // «Читать целиком» показывается только когда текст действительно не влез:
  // у большинства записей справочника описание в две-три строки, и вечная
  // подпись под ними обещала бы продолжение, которого нет.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [article]);

  if (article === undefined) return null;

  return (
    <div className="home-section">
      <SectionHeading level="section" icon="systems">
        Напомню!
      </SectionHeading>
      {article ? (
        <div
          className="card home-article"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            // Ссылка-меншен внутри тела ведёт к своей сущности — её щелчок не
            // должен ещё и открывать статью, поверх которой он стоит.
            if ((e.target as HTMLElement).closest("a")) return;
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <div className="home-article-path">{article.path.join(" · ")}</div>
          <h3 className="home-article-title">{article.name}</h3>
          <div
            ref={bodyRef}
            className={`home-article-body${clipped ? " home-article-body-clipped" : ""}`}
          >
            <MentionText text={article.description} />
          </div>
          {clipped && (
            <span className="home-article-more">
              Читать целиком
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          )}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon="issueStamp"
            title="Справочник пока пуст"
            hint="Заполняйте справочники систем — здесь будет появляться случайная статья из них."
          />
        </div>
      )}
      {open && article && (
        <EntityPreviewModal type="compendium_entry" id={article.id} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
