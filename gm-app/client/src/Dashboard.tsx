import { useEffect, useState } from "react";
import type { Campaign } from "./types";

interface Props {
  onOpenCampaign: (campaign: Campaign) => void;
}

export function Dashboard({ onOpenCampaign }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    window.gmApp
      .apiGet<Campaign[]>("/api/campaigns")
      .then(setCampaigns)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!campaigns) return <p className="muted">Загрузка…</p>;
  if (campaigns.length === 0) return <p className="muted">Кампаний пока нет.</p>;

  return (
    <div className="card stack">
      <strong className="entry-title">Кампании</strong>
      {campaigns.map((c) => (
        <button key={c.id} onClick={() => onOpenCampaign(c)} style={{ alignSelf: "flex-start" }}>
          {c.name}
          {c.system_name && <span className="muted"> — {c.system_name}</span>}
        </button>
      ))}
    </div>
  );
}
