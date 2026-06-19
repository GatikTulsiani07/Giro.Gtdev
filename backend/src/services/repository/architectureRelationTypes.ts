export type ArchitectureRelationKind =
  | "imports"
  | "calls"
  | "depends_on";

export interface ArchitectureRelationRule {
  relationKind: ArchitectureRelationKind;
  confidence: number;
}

export interface ArchitectureRelationMatch {
  sourceComponent: string;
  targetComponent: string;
  relationKind: ArchitectureRelationKind;
  confidence: number;
}

export interface ArchitectureRelationDetectionResult {
  repositoryId: string;
  matches: readonly ArchitectureRelationMatch[];
}