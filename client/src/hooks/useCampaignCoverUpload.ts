import { useRef, useState } from "react";
import { useAction, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { campaignFieldsAffects } from "../data/campaigns";
import { useImageCrop } from "./useImageCrop";

/**
 * Обложка кампании из меню «…»: щелчок пункта → выбор файла → обрезка 16:10 →
 * POST /campaigns/:id/thumbnail. Нужен там, где нет кликабельной обложки —
 * у кампаний с ролью «Я игрок» её в «Обзоре» нет (CampaignDetailPage), а из
 * списка обложку раньше поставить было нечем. Адрес и обрезку делают те же,
 * что и у мастерского обзора: файл кладётся в папку кампании как thumbnail.*.
 */
export function useCampaignCoverUpload() {
  const run = useAction();
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<number | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    const campaignId = target.current;
    if (campaignId == null) return;
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      await run(
        labelled("Обложка кампании", () =>
          write.post(`/campaigns/${campaignId}/thumbnail`, form, { timeoutMs: 120_000 })
        ),
        { affects: campaignFieldsAffects(campaignId) }
      );
    } finally {
      setUploading(false);
    }
  }

  // Цель — в ref, а не в state: файл приходит из onChange уже после щелчка по
  // пункту меню, и замыкание обрезки должно видеть выбранную кампанию сразу.
  const crop = useImageCrop("thumbnail", (file) => void upload(file));

  function pick(campaignId: number) {
    target.current = campaignId;
    input.current?.click();
  }

  return { pick, uploading, input, modal: crop.modal, onSelect: crop.onSelect };
}
