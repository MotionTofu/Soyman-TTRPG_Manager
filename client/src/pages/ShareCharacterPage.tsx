import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { readOnce } from "../data/imperative";
import { DndCharacterView } from "../components/dnd/DndCharacterForm";
import { PageFrame } from "../components/PageFrame";
import type { DndCharacterData } from "../types";

// Read-only shared character (phase D2.1): the GM opens a capability link,
// no login, no writes. Snapshot semantics — reload to see a republished
// version; nothing here streams live.

interface ShareBundle {
  format: string;
  version: number;
  characterUid: string;
  character: { name: string; content: unknown; archivedAt: string | null };
  portrait: string | null;
  catalog: unknown;
  updatedAt: string;
}

export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,}$/.test(value);
}

function isShareBundle(value: unknown): value is ShareBundle {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  if (doc.format !== "soyman-character-share") return false;
  const character = doc.character as Record<string, unknown> | undefined;
  if (!character || typeof character !== "object") return false;
  const content = character.content as { classes?: unknown; abilities?: unknown } | undefined;
  if (!content || typeof content !== "object" || !Array.isArray(content.classes) || !content.abilities) return false;
  return true;
}

export function ShareCharacterPage() {
  const { token } = useParams();
  const [bundle, setBundle] = useState<ShareBundle | null>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isShareToken(token)) {
        setInvalid(true);
        return;
      }
      try {
        const fetched = await readOnce<unknown>(`/public/character-share/${token}`);
        if (cancelled) return;
        if (isShareBundle(fetched)) setBundle(fetched);
        else setInvalid(true);
      } catch {
        if (!cancelled) setInvalid(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);
  if (invalid) {
    return (
      <PageFrame title="Ссылка недействительна">
        <p className="muted">Эта ссылка больше недействительна. Попросите игрока поделиться персонажем заново.</p>
      </PageFrame>
    );
  }
  if (!bundle) {
    return (
      <PageFrame title="Открываем персонажа…">
        <p className="muted">Загружаем опубликованную версию.</p>
      </PageFrame>
    );
  }
  return (
    <PageFrame title={bundle.character.name}>
      <p className="muted">Персонаж, которым поделились через SoyMan</p>
      <DndCharacterView
        value={bundle.character.content as DndCharacterData}
        portraitUrl={bundle.portrait}
        readOnly
      />
    </PageFrame>
  );
}
