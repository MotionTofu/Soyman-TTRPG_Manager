import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink } from "react-router-dom";
import { NavIcon } from "../../components/NavIcons";
import "./map-workspace.css";
import { useMapWorkspace } from "./workspaceContext";

/** Инструменты принадлежат редактору, их место на экране — общей оболочке. */
export function MapWorkspaceTools({ children }: { children: ReactNode }) {
  const workspace = useMapWorkspace();
  if (!workspace) return children;
  return workspace.rail ? createPortal(children, workspace.rail) : null;
}

export function MapWorkspaceRail({ returnTo, setRail, searchOpen, onSearch }: {
  returnTo: string;
  setRail: (element: HTMLDivElement | null) => void;
  searchOpen: boolean;
  onSearch: () => void;
}) {
  return (
    <aside className="map-workspace-rail" aria-label="Рабочее пространство карт">
      <NavLink to={returnTo} title="Вернуться в приложение" aria-label="Вернуться в приложение"><NavIcon name="navBack" /></NavLink>
      <NavLink to="/maps" end title="Мои карты" aria-label="Мои карты"><NavIcon name="map" /></NavLink>
      <Link to="/maps?create=1" title="Создать карту" aria-label="Создать карту"><NavIcon name="plus" /></Link>
      <div className="map-workspace-rail-tools" ref={setRail} />
      <button type="button" className="map-workspace-search-toggle" onClick={onSearch}
        aria-label="Поиск и мешок" aria-controls="search-panel" aria-expanded={searchOpen} title="Поиск и мешок"><NavIcon name="search" /></button>
    </aside>
  );
}
