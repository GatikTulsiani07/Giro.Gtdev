// Deterministic graph-traversal weighting. Boosts files structurally close to
// seed dependency-graph nodes via multi-source undirected BFS. NOT AI, no route
// change. Pure: no randomness, no timestamps; inputs are never mutated.
//
// Weight tiers (undirected shortest distance to the nearest seed):
//   distance 0        -> weight 1,    reason "seed"
//   distance 1        -> weight 0.75, reason "direct_neighbor"
//   distance 2 or 3   -> weight 0.5,  reason "nearby_dependency"
//   distance >= 4     -> weight 0,    reason "unrelated" (distance is the number)
//   unreachable       -> weight 0,    reason "unrelated" (distance null)

export interface GraphTraversalWeightInput {
  filePath: string;
  seedFiles: string[];
  dependencyEdges: Array<{ from: string; to: string }>;
}

export interface GraphTraversalWeightResult {
  filePath: string;
  distance: number | null;
  weight: number;
  reason: "seed" | "direct_neighbor" | "nearby_dependency" | "unrelated";
}

// Build an undirected adjacency map, ignoring duplicate edges, self-loops, and
// edges with a missing/empty endpoint.
function buildAdjacency(
  edges: Array<{ from: string; to: string }>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    let set = adj.get(a);
    if (!set) {
      set = new Set<string>();
      adj.set(a, set);
    }
    set.add(b);
  };
  for (const edge of edges) {
    const from = edge.from;
    const to = edge.to;
    if (!from || !to || from === to) continue;
    link(from, to);
    link(to, from);
  }
  return adj;
}

// Multi-source BFS shortest distance from any seed to filePath, or null.
function shortestDistanceToSeed(
  filePath: string,
  seeds: Set<string>,
  adj: Map<string, Set<string>>,
): number | null {
  if (seeds.has(filePath)) return 0;

  const visited = new Set<string>(seeds);
  let frontier: string[] = [...seeds];
  let distance = 0;

  while (frontier.length > 0) {
    distance += 1;
    const next: string[] = [];
    for (const node of frontier) {
      const neighbors = adj.get(node);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        if (neighbor === filePath) return distance;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return null;
}

function classify(distance: number | null): {
  weight: number;
  reason: GraphTraversalWeightResult["reason"];
} {
  if (distance === 0) return { weight: 1, reason: "seed" };
  if (distance === 1) return { weight: 0.75, reason: "direct_neighbor" };
  if (distance === 2 || distance === 3) return { weight: 0.5, reason: "nearby_dependency" };
  // distance null (unreachable) OR a number >= 4 (far-but-reachable)
  return { weight: 0, reason: "unrelated" };
}

export function calculateGraphTraversalWeight(
  input: GraphTraversalWeightInput,
): GraphTraversalWeightResult {
  const seeds = new Set(input.seedFiles);
  if (seeds.size === 0) {
    return { filePath: input.filePath, distance: null, weight: 0, reason: "unrelated" };
  }
  const adj = buildAdjacency(input.dependencyEdges);
  const distance = shortestDistanceToSeed(input.filePath, seeds, adj);
  const { weight, reason } = classify(distance);
  return { filePath: input.filePath, distance, weight, reason };
}

export function rankFilesByGraphTraversalWeight(
  filePaths: string[],
  seedFiles: string[],
  dependencyEdges: Array<{ from: string; to: string }>,
): GraphTraversalWeightResult[] {
  const results = filePaths.map((filePath) =>
    calculateGraphTraversalWeight({ filePath, seedFiles, dependencyEdges }),
  );

  return results.sort((a, b) => {
    if (a.weight !== b.weight) return b.weight - a.weight; // weight desc
    // distance asc with null LAST
    if (a.distance !== b.distance) {
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    }
    return a.filePath.localeCompare(b.filePath); // filePath asc
  });
}
