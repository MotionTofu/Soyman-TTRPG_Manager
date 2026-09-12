import { useParams } from "react-router-dom";
import { PlayersWorkspace } from "./PlayersWorkspace";

// каркас в обход намеренно — это не страница, а перенаправление: весь вид
// рисует PlayersWorkspace, и каркас, если понадобится, встанет там.
export function PlayerDetailPage() {
  const { id } = useParams();
  return <PlayersWorkspace selectedId={id != null ? Number(id) : undefined} />;
}
