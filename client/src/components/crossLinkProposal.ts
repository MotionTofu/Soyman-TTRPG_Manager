// Находка прохода расстановки ссылок (server/src/import/crossLinks.ts).

export type Tier = "exact" | "likely" | "doubtful";

export interface CrossLinkProposal {
  ownerType: string;
  ownerId: number;
  ownerName: string;
  ownerLabel: string;
  field: string;
  fieldLabel: string;
  ref: string;
  targetName: string;
  matched: string;
  context: string;
  via: string;
  tier: Tier;
  doubt?: string;
}

export const proposalId = (p: CrossLinkProposal) =>
  `${p.ownerType}|${p.ownerId}|${p.field}|${p.ref}|${p.matched}`;
