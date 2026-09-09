// Индикатор долгого экспорта (система / сеттинг / приключение).
//
// Сервер собирает выгрузку одним синхронным запросом: настоящего процента
// готовности у него нет, а с изображениями ответ может идти десятки секунд
// (общий таймаут api — 10с, поэтому экспорт зовёт api с timeoutMs: 120000).
// Чтобы не выглядело зависшим, показываем бесконечную полосу + сменяющиеся
// стадии («Собираем данные…» → «Упаковываем изображения…» → …).
import { useEffect, useState } from "react";

const DEFAULT_STAGES = [
  "Собираем данные…",
  "Упаковываем изображения…",
  "Готовим файл к скачиванию…",
];

export function ExportProgress({
  label = "Идёт экспорт…",
  stages = DEFAULT_STAGES,
  error = null,
}: {
  label?: string;
  stages?: string[];
  error?: string | null;
}) {
  const [stage, setStage] = useState(0);

  // Стадии — чисто косметические («процесс жив»), тикают пока нет ошибки.
  useEffect(() => {
    if (error) return;
    if (stages.length <= 1) return;
    const t = setInterval(() => setStage((s) => (s + 1) % stages.length), 2500);
    return () => clearInterval(t);
  }, [error, stages.length]);

  return (
    <div className="export-progress" role="status" aria-live="polite">
      <div className="export-progress-bar" aria-hidden="true">
        <div className={`export-progress-fill${error ? " is-error" : ""}`} />
      </div>
      {error ? (
        <div className="export-progress-error">{error}</div>
      ) : (
        <div className="muted">
          {label} {stages[stage]}
        </div>
      )}
    </div>
  );
}
