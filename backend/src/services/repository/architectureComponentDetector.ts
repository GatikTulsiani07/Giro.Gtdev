import type {
    ArchitectureComponentDetectionResult,
    ArchitectureComponentRule,
  } from "./architectureComponentTypes.js";
  import { matchFileToComponent } from "./architectureComponentMatcher.js";
  
  export function detectArchitectureComponents(
    repositoryId: string,
    filePaths: readonly string[],
    rules: readonly ArchitectureComponentRule[],
  ): ArchitectureComponentDetectionResult {
    const matches = filePaths
      .map((filePath) => matchFileToComponent(filePath, rules))
      .filter((match) => match !== null);
  
    return {
      repositoryId,
      matches,
    };
  }