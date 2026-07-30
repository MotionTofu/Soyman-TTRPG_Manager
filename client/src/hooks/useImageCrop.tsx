import { useState } from "react";
import { ImageCropModal, type CropShape } from "../components/ImageCropModal";

// Drop-in wrapper for a raw `(file: File | null) => void` upload handler:
// wire `onSelect` into the <input type="file"> onChange and render `modal`
// nearby. Picking a file opens a crop dialog (skippable) before the
// resulting File reaches `onDone`.
export function useImageCrop(shape: CropShape, onDone: (file: File) => void) {
  const [pending, setPending] = useState<File | null>(null);

  function onSelect(file: File | null) {
    if (file) setPending(file);
  }

  const modal = pending ? (
    <ImageCropModal
      file={pending}
      shape={shape}
      onCancel={() => setPending(null)}
      onSkip={(file) => {
        setPending(null);
        onDone(file);
      }}
      onConfirm={(file) => {
        setPending(null);
        onDone(file);
      }}
    />
  ) : null;

  return { onSelect, modal };
}
