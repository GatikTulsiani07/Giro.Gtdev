import type { RepositoryArchitectureInference } from "./architectureInferenceTypes.js";

export function generateArchitectureSummary(
  inference: RepositoryArchitectureInference,
): string {
  const layerCount = inference.layers.length;
  const componentCount = inference.components.length;
  const relationCount = inference.relations.length;

  return [
    `Repository: ${inference.repositoryId}`,
    `Layers Detected: ${layerCount}`,
    `Components Detected: ${componentCount}`,
    `Relations Detected: ${relationCount}`,
    `Confidence: ${inference.confidence}`,
  ].join("\n");
}