import { detectArchitectureRelations } from "./architectureRelationDetector.js";
import type {
  ArchitectureRelationDetectionResult,
  ArchitectureRelationKind,
} from "./architectureRelationTypes.js";

export function analyzeArchitectureRelations(
  repositoryId: string,
  components: readonly string[],
  relationKind: ArchitectureRelationKind,
): ArchitectureRelationDetectionResult {
  return detectArchitectureRelations(
    repositoryId,
    components,
    relationKind,
  );
}