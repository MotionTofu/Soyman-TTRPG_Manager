import { Link } from "react-router-dom";
import { NavIcon } from "./NavIcons";

/**
 * «Показать в графе» — открывает граф связей не целиком, а окрестностью этой
 * сущности: кто на неё завязан и через кого. Общий граф на сотнях узлов на
 * такой вопрос за столом не отвечает, а два шага от нужного имени — отвечают.
 */
export function GraphNeighbourhoodLink({ type, id }: { type: string; id: number }) {
  return (
    <Link
      to={`/graph?focus=${type}:${id}&depth=2`}
      className="graph-neighbourhood-link"
      title="Открыть граф связей вокруг этой сущности"
    >
      <NavIcon name="graph" /> Показать в графе
    </Link>
  );
}
