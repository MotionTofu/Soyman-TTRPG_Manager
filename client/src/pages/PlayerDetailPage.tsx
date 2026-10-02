import { useParams } from "react-router-dom";
import { PlayerProfilePanel } from "../components/players/PlayerProfilePanel";

// Профиль игрока — своя страница на бумаге (спека campaign-paper, Q47);
// список игроков — плитками, щелчок ведёт сюда.
// каркас в обход намеренно — EntityPage рисует сам PlayerProfilePanel, здесь только id из адреса.
export function PlayerDetailPage() {
  const { id } = useParams();
  return <PlayerProfilePanel key={id} playerId={Number(id)} />;
}
