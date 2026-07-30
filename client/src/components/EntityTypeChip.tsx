import { ENTITY_TYPE_SINGULAR } from "../entityTypes";

interface Props {
  type: string;
}

export function EntityTypeChip({ type }: Props) {
  return <span className={`entity-type-chip ${type}`}>{ENTITY_TYPE_SINGULAR[type] ?? type}</span>;
}
