import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { EntityPreviewModal } from "./EntityPreviewModal";
import { MentionText } from "./mentions/MentionText";

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
    let last: string | null = null;
    try { last = sessionStorage.getItem(LAST_SHOWN_KEY); } catch {}
    api
      .get<RandomArticle | null>(`/random-article${last ? `?exclude=${encodeURIComponent(last)}` : ""}`)
      .then((next) => {
        setArticle(next);
        if (next) try { sessionStorage.setItem(LAST_SHOWN_KEY, String(next.id)); } catch {}
      })
      .catch(() => setArticle(null));
  }, []);

  // «Читать целиком» показывается только когда текст действительно не влез.
  // Пересчитываем и на ресайз (ResizeObserver) — иначе после поворота телефона флаг врёт.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [article]);

  if (article === undefined || article === null) return null;

  // Единственный блок главной, который каждый раз другой, — и единственный,
  // имеющий право выглядеть вырванным из журнала. Поэтому не карточка с
  // заголовком секции над ней, а вырезка: чернильная плашка-шапка с
  // названием внутри, рваный нижний край, штамп выпуска.
  //
  // Наклона нет. Он был единственным наклонённым объектом на экране и потому
  // читался не как приём, а как сбой вёрстки: §5.5 разрешает наклон бейджам,
  // наклейкам и одной карточке в РЯДУ — то есть там, где рядом есть ровные
  // соседи, на фоне которых наклон заметен нарочно.
  const issue = (() => {
    const now = new Date();
    // ISO-неделя (понедельник-четверг) — не врёт на 1 января (воскресенье → 52 неделя прошлого года)
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `ВЫПУСК ${d.getUTCFullYear()}.${week}`;
  })();

  return (
    <div className="home-section">
      <div
        // Затухание обрезанного тела рисуется на самом блоке, а не на колонке
        // прозы: только так оно доходит до низа вырезки и до её краёв.
        className={`home-article${clipped ? " home-article-clipped" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`Открыть статью: ${article.name}, ${issue}`}
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
        <div className="home-article-band">
          <span className="home-article-band-title">Напомню!</span>
          <span className="home-article-issue">{issue}</span>
        </div>
        {/* Вырезка занимает всю ширину колонки, а мера строки держится
            разворотом: слева — откуда статья и как называется, справа —
            сама проза. Ограничение ширины было на блоке целиком, и вырезка
            стояла узкой полосой с пустым листом справа от себя. */}
        <div className="home-article-body-wrap">
          <div className="home-article-head">
            <div className="home-article-path">{article.path.join(" · ")}</div>
            <h3 className="home-article-title">{article.name}</h3>
          </div>
          <div className="home-article-text">
            <div
              ref={bodyRef}
              className="home-article-body"
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
        </div>
      </div>
      {open && (
        <EntityPreviewModal type="compendium_entry" id={article.id} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
