import { useState } from "react";
import { Modal } from "../Modal";
import type { WizardRandom } from "./DndCharacterWizard";
import "./sheet-chrome.css";

export const D20_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2l9 5v10l-9 5-9-5V7z" />
    <path d="M12 2L7.5 9.5h9zM7.5 9.5L3 17h9M16.5 9.5L21 17h-9M7.5 9.5L12 17l4.5-7.5" />
  </svg>
);

/**
 * Окно «Случайный герой» (гриллинг 2026-09-26): уровень, «Играбельно / Полный
 * хаос» и имя. Общее для OneShot (имя — из поля на главной) и основного SoyMan
 * (имя — «из профиля» или «случайное», Q6). Облик задаёт хост классом:
 * OneShot — своими стилями главной, основной SoyMan — .random-hero.
 */
export function RandomHeroDialog({
  className,
  name,
  askName,
  busy,
  onClose,
  onGo,
}: {
  className: string;
  /** Имя, которое можно оставить персонажу. */
  name: string;
  /** true — выбор «из профиля / случайное»; false — только подпись (OneShot). */
  askName: boolean;
  busy?: boolean;
  onClose: () => void;
  onGo: (random: WizardRandom) => void;
}) {
  const [level, setLevel] = useState(1);
  const [mode, setMode] = useState<WizardRandom["mode"]>("playable");
  const hasName = name.trim() !== "";
  const [keepName, setKeepName] = useState(hasName);

  return (
    <Modal className={className} ariaLabel="Случайный герой" onClose={onClose}>
      <div className="lib-random-head">
        <h2>Случайный герой</h2>
        <button type="button" className="lib-random-x" aria-label="Закрыть" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.2" />
          </svg>
        </button>
      </div>
      <div className="lib-random-field">
        <span className="lib-random-label">Уровень</span>
        <div className="lib-random-level">
          <button type="button" aria-label="Уровень меньше" disabled={level <= 1} onClick={() => setLevel((l) => Math.max(1, l - 1))}>
            −
          </button>
          <output aria-live="polite">{level}</output>
          <button type="button" aria-label="Уровень больше" disabled={level >= 20} onClick={() => setLevel((l) => Math.min(20, l + 1))}>
            +
          </button>
          <span>из 20</span>
        </div>
      </div>
      <div className="lib-random-field">
        <span className="lib-random-label">Как бросаем</span>
        <div className="lib-seg lib-random-seg" role="group" aria-label="Как бросаем">
          <button type="button" aria-pressed={mode === "playable"} onClick={() => setMode("playable")}>
            Играбельно
          </button>
          <button type="button" aria-pressed={mode === "chaos"} onClick={() => setMode("chaos")}>
            Полный хаос
          </button>
        </div>
        <p>
          {mode === "playable"
            ? "Класс, вид и предыстория — наугад. Характеристики разложены под класс, всё остальное — из разрешённого."
            : "Всё наугад: характеристики — 4к6 вразброс, прибавки и выборы — куда выпадет. Но по правилам."}
        </p>
      </div>
      {askName && hasName ? (
        <div className="lib-random-field">
          <span className="lib-random-label">Имя</span>
          <div className="lib-seg lib-random-seg" role="group" aria-label="Имя">
            <button type="button" aria-pressed={keepName} onClick={() => setKeepName(true)}>
              Из профиля
            </button>
            <button type="button" aria-pressed={!keepName} onClick={() => setKeepName(false)}>
              Случайное
            </button>
          </div>
          <p className="lib-random-name">
            {keepName ? (
              <>
                Будет <b>{name.trim()}</b>.
              </>
            ) : (
              "Возьмём случайное — по виду, который выпадет."
            )}
          </p>
        </div>
      ) : (
        <p className="lib-random-name">
          {hasName ? (
            <>
              Имя: <b>{name.trim()}</b> — из поля на главной.
            </>
          ) : (
            "Имя возьмём случайное — по виду, который выпадет."
          )}
        </p>
      )}
      <span className="lib-random-shadow">
        <button
          type="button"
          className="lib-random-btn lib-random-go"
          disabled={busy}
          onClick={() => onGo({ level, mode, keepName: hasName && keepName })}
        >
          {D20_ICON}Поехали
        </button>
      </span>
    </Modal>
  );
}
