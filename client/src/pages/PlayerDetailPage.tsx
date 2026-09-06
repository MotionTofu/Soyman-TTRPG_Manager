import { useParams } from "react-router-dom";
import { PlayersWorkspace } from "./PlayersWorkspace";

export function PlayerDetailPage() {
  const { id } = useParams();
  return <PlayersWorkspace selectedId={id != null ? Number(id) : undefined} />;
}
