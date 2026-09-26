import { Navigate, useLocation, useParams } from "react-router-dom";

/**
 * Старый адрес листа на весь экран. С «персонаж = лист» (гриллинг 2026-09-27,
 * Q29) лист открывается прямо на `/characters/:id`; ссылки из упоминаний и
 * закладок ведут туда же, с тем же `?sheet=` вкладки.
 */
export function CharacterSheetPage() {
  const { id } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/characters/${id}${search}`} replace />;
}
