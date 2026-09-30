import { ENTITY_TYPE_SINGULAR } from "../entityTypes";
import { TypeGlyph } from "./TypeGlyph";

interface Props {
  type: string;
}

export function EntityTypeChip({ type }: Props) {
  return (
    <span className={`entity-type-chip ${type}`}>
      <TypeGlyph type={type} />
      {ENTITY_TYPE_SINGULAR[type] ?? type}
    </span>
  );
}
