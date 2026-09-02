import { useSyncExternalStore } from "react";
import { EntityPreviewModal } from "../EntityPreviewModal";
import {
  getMentionPreview,
  subscribeMentionPreview,
  closeMentionPreview,
} from "./mentionPreviewStore";

export function MentionPreviewRoot() {
  const preview = useSyncExternalStore(subscribeMentionPreview, getMentionPreview, getMentionPreview);
  if (!preview) return null;
  return <EntityPreviewModal type={preview.type} id={preview.id} onClose={closeMentionPreview} />;
}
