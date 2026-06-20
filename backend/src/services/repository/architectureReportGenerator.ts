import type { RepositoryArchitectureInference }
from "./architectureInferenceTypes.js";

export function generateArchitectureReport(
  architecture: RepositoryArchitectureInference,
): string {

  const lines: string[] = [];

  lines.push(`# Architecture Report`);
  lines.push("");

  lines.push(`Layers: ${architecture.layers.length}`);
  lines.push(`Components: ${architecture.components.length}`);
  lines.push(`Relations: ${architecture.relations.length}`);
  lines.push("");

  lines.push(`## Layers`);

  for (const layer of architecture.layers) {
    lines.push(`- ${layer.name}`);
  }

  lines.push("");
  lines.push(`## Components`);

  for (const component of architecture.components) {
    lines.push(`- ${component.name}`);
  }

  return lines.join("\n");
}