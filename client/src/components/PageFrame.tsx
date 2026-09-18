// Лёгкий каркас страницы: шапка, состояния загрузки, содержимое.
//
// ЗАЧЕМ. Карточка сущности и каталог получили свои каркасы, а остальные
// страницы с шапкой — служебные, домашние, визарды, Мастерская, Пульт
// звука — собирали шапку каждая по-своему: заголовок, под ним или рядом ряд
// кнопок, своя карточка ошибки. Разбор П3.6 (Q65–Q71, 2026-09-18) решил:
// один лёгкий каркас на все такие страницы, а не по каркасу на вид — у
// «Служебного» и «Визарда» по две-три страницы, и пять заготовок одной и той
// же шапки — путь к «общей заготовке с пятнадцатью флагами».
//
// СОСТАВ ГНЁЗД ЗАКРЫТ. Сверху вниз:
//
//     шапка: заголовок слева · действия справа (та же, что у каталогов)
//     тело — под `Loadable`, если страница передала `state`
//
// Заглушка доступа («Только для мастера») — не гнездо, а тело страницы
// (Q70): она есть у двух страниц из десяти. Ссылки «← родитель» у шапки нет
// (Q69): родителя показывают крошки оболочки.
//
// ЧЕГО КАРКАС НЕ РЕШАЕТ. Вкладки, тулбары, раскладка тела — дело страницы.
// Ошибка действия поверх живого содержимого (не удалась проверка, а журнал
// рядом работает) — баннер `LoadErrorCard` в теле, а не `state`: обёртка
// спрятала бы рабочую страницу (см. шапку `Loadable.tsx`).
//
// СТРАНИЦЫ БЕЗ ОБВЯЗКИ. Показ, Предпросмотр показа, Отстыкованная панель,
// Сейчас играем, Полотно, Редактор карт, Граф, Живая сессия — намеренно без
// каркаса: проектор, отдельное окно, мини-экран и полноэкранные инструменты
// со своей раскладкой (Q65).
import type { ReactNode } from "react";
import { Loadable } from "./Loadable";
import { SectionHeading } from "./SectionHeading";
import type { NavIconName } from "./NavIcons";

export interface PageHeadProps {
  /** Ключ иконки раздела (`health`, `campaigns`, …). Нет — без привязки. */
  section?: NavIconName;
  title: ReactNode;
  /** Действия справа от заголовка. */
  actions?: ReactNode;
}

/** Шапка страницы — общая у каталогов (`ListPage`) и у каркаса ниже (Q68). */
export function PageHead({ section, title, actions }: PageHeadProps) {
  return (
    <div className="row page-head">
      <SectionHeading section={section} compact>
        {title}
      </SectionHeading>
      {actions && <div className="row page-head__actions">{actions}</div>}
    </div>
  );
}

export interface PageFrameState {
  loading: boolean;
  error: string | null;
  /** Начало карточки ошибки: «Не удалось загрузить календарь». */
  errorTitle: string;
  onRetry: () => void;
  skeleton: ReactNode;
}

export interface PageFrameProps extends PageHeadProps {
  /** Свой класс корня страницы (`health-page`) — для отступов тела. */
  className?: string;
  /** Загрузка и ошибка данных страницы. Нет — тело показывается сразу. */
  state?: PageFrameState;
  children: ReactNode;
}

export function PageFrame({ section, title, actions, className, state, children }: PageFrameProps) {
  return (
    <div className={`stack page-frame${className ? ` ${className}` : ""}`}>
      <PageHead section={section} title={title} actions={actions} />
      {state ? <Loadable {...state}>{children}</Loadable> : children}
    </div>
  );
}
