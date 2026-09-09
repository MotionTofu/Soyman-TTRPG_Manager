import { useEffect, useState } from "react";
import { PresentationStage } from "../components/presentation/PresentationStage";
import { FullscreenButton } from "../components/presentation/FullscreenButton";
import { onPreview, readLastPreview, type PreviewPayload } from "../components/presentation/previewChannel";

// Окно предпросмотра черновика из редактора представления — второй монитор.
// Рендерится вне <AppShell>: только кадр 16:9 на чёрном. Полезная нагрузка
// едет из редактора (localStorage + BroadcastChannel), серверный show-state
// не трогается — черновик не должен утекать на экран игроков.
export function PresentationPreviewPage() {
  const [payload, setPayload] = useState<PreviewPayload | null>(() => readLastPreview());

  useEffect(() => onPreview(setPayload), []);

  useEffect(() => {
    document.title = "Предпросмотр";
    return () => {
      document.title = "SoyMan";
    };
  }, []);

  return (
    <div style={{ background: "#000", minHeight: "100vh" }}>
      <FullscreenButton />
      {payload ? (
        <PresentationStage
          backgroundUrl={payload.background_url}
          layers={payload.layers}
          visibleIds={payload.visibleIds}
          fadeMs={payload.fadeMs}
          transition={payload.transition}
          transitionMs={payload.transitionMs}
          title={payload.title}
          titleSecs={payload.titleSecs}
          playKey={payload.playKey}
          interactive
          waitingLabel="Предпросмотр"
        />
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            color: "var(--muted)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-micro)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Откройте предпросмотр из редактора представления
        </div>
      )}
    </div>
  );
}
