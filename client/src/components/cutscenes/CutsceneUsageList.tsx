import { Link } from "react-router-dom";
import type { CutsceneUsage } from "@shared/cutscenes/usage";

export function CutsceneUsageList({ usage }: { usage: CutsceneUsage }) {
  return <div className="stack reading-text" aria-label="Использование катсцены">
    {usage.places.length ? <>
      <p>Удаление запрещено, пока катсцена используется:</p>
      <ul>{usage.places.map(place => <li key={place.key}>{place.href ? <Link to={place.href}>{place.label}</Link> : place.label}</li>)}</ul>
      <p>Уберите ссылки из подборок и планов, завершите показы и репетиции, замените оставленный кадр и остановите музыку.</p>
    </> : <p>Привязок и сохранённого использования нет.</p>}
  </div>;
}
