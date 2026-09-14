import { Link } from "react-router-dom";
import { NavIcon } from "./NavIcons";
import { TYPE_GRAPH_VIEW } from "../graphTypes";

/**
 * «Показать в графе» — открывает граф связей не целиком, а окрестностью этой
 * сущности: кто на неё завязан и через кого. Общий граф на сотнях узлов на
 * такой вопрос за столом не отвечает, а два шага от нужного имени — отвечают.
 *
 * Вид графа определяется типом сущности (решения 2026-09-12, п. 5).
 */
export function GraphNeighbourhoodLink({ type, id }: { type: string; id: number }) {
  const view = TYPE_GRAPH_VIEW[type] ?? "world";
  return (
    <Link
      to={`/graph/${view}?focus=${type}:${id}&depth=2`}
      className="graph-neighbourhood-link"
      title="Открыть граф связей вокруг этой сущности"
    >
      <NavIcon name="graph" /> Показать в графе
    </Link>
  );
}
