import type { CampaignType, PaymentFrequency, PaymentType, RateSplit } from "./types";

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  free: "Бесплатная",
  paid: "Платная",
  negotiable: "Условно платная",
};

export const PAYMENT_TYPE_OPTIONS: { value: PaymentType; label: string }[] = [
  { value: "free", label: PAYMENT_TYPE_LABELS.free },
  { value: "paid", label: PAYMENT_TYPE_LABELS.paid },
  { value: "negotiable", label: PAYMENT_TYPE_LABELS.negotiable },
];

export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  campaign: "Кампания",
  oneshot: "Ваншот",
};

export const CAMPAIGN_TYPE_OPTIONS: { value: CampaignType; label: string }[] = [
  { value: "campaign", label: CAMPAIGN_TYPE_LABELS.campaign },
  { value: "oneshot", label: CAMPAIGN_TYPE_LABELS.oneshot },
];

export const PAYMENT_FREQUENCY_LABELS: Record<PaymentFrequency, string> = {
  per_session: "Раз в сессию",
  per_month: "Раз в месяц",
};

export const PAYMENT_FREQUENCY_OPTIONS: { value: PaymentFrequency; label: string }[] = [
  { value: "per_session", label: PAYMENT_FREQUENCY_LABELS.per_session },
  { value: "per_month", label: PAYMENT_FREQUENCY_LABELS.per_month },
];

export const RATE_SPLIT_LABELS: Record<RateSplit, string> = {
  per_person: "С человека",
  per_table: "Сумма со стола",
};

export const RATE_SPLIT_OPTIONS: { value: RateSplit; label: string }[] = [
  { value: "per_person", label: RATE_SPLIT_LABELS.per_person },
  { value: "per_table", label: RATE_SPLIT_LABELS.per_table },
];
