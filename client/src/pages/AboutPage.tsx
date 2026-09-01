import { useState } from "react";
import { openExternalLink, openTelegramLink } from "../electronApi";
import { ExternalLinkConfirmModal, BOOSTY_URL } from "../components/ExternalLinkConfirmModal";
import { SectionHeading } from "../components/SectionHeading";
import { UpdateChecker } from "../components/UpdateChecker";
import { NavIcon } from "../components/NavIcons";

const HOTKEYS: { combo: string; where: string; does: string }[] = [
  { combo: "@", where: "любое текстовое поле", does: "открыть поиск и вставить упоминание сущности" },
  { combo: "Alt + Q", where: "любое текстовое поле", does: "то же самое, что «@», но без набора символа" },
  { combo: "Ctrl + B", where: "любое текстовое поле", does: "обернуть выделение в **жирный текст**" },
  { combo: "Alt + W", where: "любое текстовое поле", does: "обернуть выделение в блок цитаты" },
  { combo: "Ctrl + K", where: "любое текстовое поле", does: "вставить внешнюю ссылку" },
  { combo: "Enter", where: "поля быстрого добавления (тег, трек, реплика и т.п.)", does: "подтвердить и добавить, не открывая отдельную форму" },
  { combo: "Esc", where: "модалки, лайтбокс, полноэкранная карта/граф, контекстное меню", does: "закрыть" },
  { combo: "← / →", where: "лайтбокс галереи, просмотр «Для игроков»", does: "предыдущее/следующее изображение или запись" },
];

const TABS = ["Версия", "Горячие клавиши", "Фишки", "Автор"] as const;
type Tab = (typeof TABS)[number];

export function AboutPage() {
  const [tab, setTab] = useState<Tab>("Версия");
  const [external, setExternal] = useState<"boosty" | "telegram" | "email" | null>(null);

  return (
    <div className="stack">
      <SectionHeading section="about" compact>Справка</SectionHeading>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Версия" && (
        <UpdateChecker />
      )}

      {tab === "Горячие клавиши" && (
        <table className="about-table">
          <thead>
            <tr>
              <th>Клавиши</th>
              <th className="about-table__where">Где</th>
              <th>Что делает</th>
            </tr>
          </thead>
          <tbody>
            {HOTKEYS.map((h) => (
              <tr key={h.combo}>
                <td className="about-table__combo">{h.combo}</td>
                <td className="muted about-table__where">{h.where}</td>
                <td>{h.does}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "Фишки" && (
        <div className="stack">
          <details className="about-sub" open>
            <summary>Мешок</summary>
            <div className="about-sub__body">
              <p className="muted">
                Мешок — это временный контейнер для сущностей в правой панели поиска.
                Удобно собрать несколько существ, локаций или предметов в одном месте,
                а потом перетащить их откуда нужно.
              </p>
              <ol>
                <li>
                  <strong>Добавить текущую страницу</strong> — находясь в профиле сущности,
                  нажмите «+» в пустом слоте мешка. Туда попадёт сущность, открытая
                  на этой странице.
                </li>
                <li>
                  <strong>Добавить из списка</strong> — в списках заклинаний, черт, существ
                  и другого компендиума рядом с каждой записью есть иконка мешка.
                  Нажмите на неё — запись сразу попадёт в мешок.
                </li>
                <li>
                  <strong>Перетащить из поиска</strong> — найдите сущность в правой панели поиска
                  и перетащите её в слот мешка.
                </li>
                <li>
                  <strong>Выгрузить на страницу</strong> — когда на странице есть подходящие зоны
                  (например, список противников или локаций в сессии),
                  кнопка «Выгрузить» вставит содержимое мешка туда.
                </li>
                <li>
                  <strong>Убрать</strong> — нажмите «✕» на заполненном слоте, чтобы удалить сущность
                  из мешка.
                </li>
              </ol>
            </div>
          </details>

          <details className="about-sub">
            <summary>Упоминания «@»</summary>
            <div className="about-sub__body">
              <p className="muted">
                В любом текстовом поле с панелью форматирования наберите «@» — откроется
                поиск по всей базе. Начните вводить название сущности, выберите её из
                списка, и ссылка вставится автоматически. Получится кликабельная ссылка,
                по которой можно перейти прямо из текста.
              </p>
              <p className="muted">
                Альтернатива: нажмите <strong>Alt + Q</strong> — откроется тот же поиск,
                но без необходимости набирать символ «@».
              </p>
              <p className="muted">
                Упоминания работают в описаниях сессий, заметках, статблоках — везде,
                где есть rich-text редактор. На основе упоминаний строится граф связей
                между сущностями.
              </p>
            </div>
          </details>

          <details className="about-sub">
            <summary>Граф связей</summary>
            <div className="about-sub__body">
              <p className="muted">
                Граф показывает, как сущности внутри кампании связаны друг с другом
                через упоминания. Каждый узел — сущность (персонаж, локация, сессия,
                предмет), каждое ребро — ссылка из одного описания в другое.
              </p>
              <p className="muted">
                Открывается из левой панели навигации (раздел «Граф связей»). Выберите
                кампанию — и увидите схему. Ноды можно перетаскивать мышкой, приближать
                и отдалять колёсиком. Клик по ноду открывает профиль сущности.
              </p>
              <p className="muted">
                Граф удобен, чтобы увидеть, какие элементы мира переплетаются, а какие
                остаются изолированными — и стоит ли их связать.
              </p>
            </div>
          </details>

          <details className="about-sub">
            <summary>Полотно приключений</summary>
            <div className="about-sub__body">
              <p className="muted">
                Узловой редактор для визуального построения приключений. Приключение
                раскладывается на холсте: сцены — ноды, переходы между ними — рёбра,
                главы — рамки вокруг групп сцен.
              </p>
              <p className="muted">
                Раскладка своя у каждой кампании. Ноды перетаскиваются мышкой, у сцены
                на холсте сразу виден её состав: локации, сюжетные персонажи, препятствия,
                лут и аудио.
              </p>
              <p className="muted">
                Запустите прогон — и приложение подсветит текущую сцену, чтобы было видно,
                где партия прямо сейчас. Переходы между сценами кликабельны.
              </p>
            </div>
          </details>

          <details className="about-sub">
            <summary>Пульт сессии</summary>
            <div className="about-sub__body">
              <p className="muted">
                Отдельный экран на время игры. Открывается по кнопке из навигации
                или из карточки ближайшей сессии.
              </p>
              <p className="muted">
                <strong>Трекер инициативы</strong> — список бойцов с HP, состояниями
                (отравлен, оглушён и т.д.) и кнопками быстрого нанесения урона или
                лечения. Бросок инициативы вводится вручную или бросается из приложения.
              </p>
              <p className="muted">
                <strong>Материалы сцены</strong> — все локации, персонажи и противники
                текущей сцены доступны без離開 пульта. Можно быстро показать изображение
                игрокам на их устройствах.
              </p>
            </div>
          </details>

          <details className="about-sub">
            <summary>Четырёхканальный плеер</summary>
            <div className="about-sub__body">
              <p className="muted">
                Фоновая музыка, эмбиент, погода и стингеры звучат одновременно — по
                одному каналу на каждый. У каждого канала своя громкость, и переключения
                происходят через кроссфейд вместо резкого щелчка.
              </p>
              <p className="muted">
                «Пульт звука» — отдельное окно на время сессии. Здесь выбирается набор
                звуков сеттинга и сессии, настраивается громкость каждого канала и
                делаются быстрые переключения.
              </p>
              <p className="muted">
                Треки привязываются к ресурсам кампании или сессии через обычный
                аудиоплеер в карточке ресурса.
              </p>
            </div>
          </details>

          <details className="about-sub">
            <summary>Шпаргалки для печати</summary>
            <div className="about-sub__body">
              <p className="muted">
                Из заготовки сессии по кнопке генерируются заполняемые печатные шпаргалки
                формата A4:
              </p>
              <ul>
                <li>
                  <strong>Сводка по сессии</strong> — краткое описание сцены, ключевые NPC,
                  их мотивы и готовые реплики.
                </li>
                <li>
                  <strong>Шпаргалка по персонажам</strong> — КЗ, пассивное восприятие,
                  навыки и основные характеристики каждого игрока.
                </li>
                <li>
                  <strong>Боевая шпаргалка</strong> — строка на каждого противника с HP,
                  КД, атаками и особыми способностями.
                </li>
              </ul>
              <p className="muted">
                Всё редактируется прямо на «листе» и уходит в PDF одной кнопкой.
              </p>
            </div>
          </details>

          <details className="about-sub">
            <summary>Роль игрока</summary>
            <div className="about-sub__body">
              <p className="muted">
                Игрок со своего устройства (телефон в той же Wi-Fi сети) входит в то же
                приложение своей учёткой. Отдельного мобильного клиента нет — всё работает
                через браузер телефона.
              </p>
              <p className="muted">
                Игрок видит: лист своего персонажа, открытые ему материалы кампании
                и календарь сессий. Не видит: мастерские заметки, статблоки противников,
                скрытые сцены.
              </p>
              <p className="muted">
                Чтобы зайти с телефона — откройте адрес сервера в браузере и войдите
                под учёткой игрока. Адрес и инструкция — в разделе «Приглашения».
              </p>
            </div>
          </details>

          <details className="about-sub">
            <summary>Темы</summary>
            <div className="about-sub__body">
              <p className="muted">
                Пять встроенных тем оформления — от яркого «Соевого панка» до сдержанного
                «Соевого нуара». Переключаются в разделе «Внешний вид».
              </p>
              <ul>
                <li><strong>Соевый панк</strong> — дерзкий, базовый. Рваные края, наклоны, красный акцент.</li>
                <li><strong>Соевый нуар</strong> — консервативный. Антиква в заголовках, без наклонов.</li>
                <li><strong>Соевый бунт</strong> — инверсия панка. Тёмный фон, светлый текст.</li>
                <li><strong>Соевый неон</strong> — кислотные цвета, единственная тема со свечением.</li>
                <li><strong>Соевая аберрация</strong> — космический стиль, «плывущие» формы.</li>
              </ul>
              <p className="muted">
                Кроме встроенных, можно создавать собственные темы и настраивать скругление
                углов карточек. Статблоки не наследуют цветовую тему приложения — у них
                своё оформление, которое можно назначить по типу существа.
              </p>
            </div>
          </details>
        </div>
      )}

      {tab === "Автор" && (
        <div className="stack">
          <p className="about-author-intro">Привет, я Тофу</p>
          <div className="about-contacts">
            <button
              type="button"
              className="about-contact"
              onClick={() => setExternal("telegram")}
            >
              <NavIcon name="telegram" className="about-contact__icon" />
              <span className="about-contact__label">Telegram</span>
              <span className="about-contact__value">t.me/brothertofu</span>
            </button>
            <button
              type="button"
              className="about-contact"
              onClick={() => setExternal("email")}
            >
              <NavIcon name="about" className="about-contact__icon" />
              <span className="about-contact__label">Email</span>
              <span className="about-contact__value">motion.tofu@gmail.com</span>
            </button>
            <button
              type="button"
              className="about-contact"
              onClick={() => setExternal("boosty")}
            >
              <NavIcon name="boosty" className="about-contact__icon" />
              <span className="about-contact__label">Boosty</span>
              <span className="about-contact__value">boosty.to/tofu_bro</span>
            </button>
          </div>
        </div>
      )}

      {external === "telegram" && (
        <ExternalLinkConfirmModal
          title="Написать автору"
          message="Вы уверены, что хотите написать автору?"
          confirmLabel="Да, прям сейчас напишу!"
          cancelLabel="Нет, не очень-то хочется"
          icon="telegram"
          onClose={() => setExternal(null)}
          onConfirm={() => {
            setExternal(null);
            openTelegramLink();
          }}
        />
      )}

      {external === "email" && (
        <ExternalLinkConfirmModal
          title="Написать автору"
          message="Откроется почтовый клиент с адресом motion.tofu@gmail.com."
          confirmLabel="Да, открыть"
          cancelLabel="Нет, спасибо"
          icon="about"
          onClose={() => setExternal(null)}
          onConfirm={() => {
            setExternal(null);
            window.open("mailto:motion.tofu@gmail.com", "_blank");
          }}
        />
      )}

      {external === "boosty" && (
        <ExternalLinkConfirmModal
          title="Поддержать проект"
          message="Вы уверены, что хотите отправиться на Бусти?"
          confirmLabel="Да, конечно"
          cancelLabel="Пожалуй, нет"
          icon="boosty"
          onClose={() => setExternal(null)}
          onConfirm={() => {
            setExternal(null);
            openExternalLink(BOOSTY_URL);
          }}
        />
      )}
    </div>
  );
}
