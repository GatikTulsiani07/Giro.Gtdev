// Deterministic route protection audit. Pure transformation over caller-provided
// route descriptors only: no route introspection, middleware changes, I/O,
// persistence, async work, randomness, or input mutation.

export type RouteProtectionGapType =
  | "missing_auth"
  | "missing_repository_ownership"
  | "missing_session_ownership"
  | "missing_session_repository_consistency"
  | "missing_input_validation";

export interface RouteProtectionDescriptor {
  method: string;
  path: string;
  area: string;
  requiresAuth: boolean;
  requiresRepositoryOwnership: boolean;
  requiresSessionOwnership: boolean;
  requiresSessionRepositoryConsistency: boolean;
  hasInputValidation: boolean;
}

export interface RouteProtectionGap {
  method: string;
  path: string;
  area: string;
  gap: RouteProtectionGapType;
  message: string;
}

export interface RouteProtectionRouteSummary {
  method: string;
  path: string;
  area: string;
  gaps: readonly RouteProtectionGapType[];
}

export interface RouteProtectionAreaSummary {
  area: string;
  totalRoutes: number;
  protectedRoutes: number;
  unprotectedRoutes: number;
  gaps: Record<RouteProtectionGapType, number>;
}

export interface RouteProtectionRecommendation {
  id: string;
  gap: RouteProtectionGapType;
  area: string;
  routeCount: number;
  title: string;
  description: string;
}

export interface RouteProtectionAudit {
  totalRoutes: number;
  protectedRoutes: number;
  unprotectedRoutes: readonly RouteProtectionRouteSummary[];
  gaps: readonly RouteProtectionGap[];
  byArea: readonly RouteProtectionAreaSummary[];
  recommendations: readonly RouteProtectionRecommendation[];
}

const GAP_ORDER: RouteProtectionGapType[] = [
  "missing_auth",
  "missing_repository_ownership",
  "missing_session_ownership",
  "missing_session_repository_consistency",
  "missing_input_validation",
];

const GAP_MESSAGES: Record<RouteProtectionGapType, string> = {
  missing_auth: "Route is not marked as authenticated.",
  missing_repository_ownership: "Route is not marked as enforcing repository ownership.",
  missing_session_ownership: "Route is not marked as enforcing session ownership.",
  missing_session_repository_consistency:
    "Route is not marked as enforcing session-to-repository consistency.",
  missing_input_validation: "Route is not marked as input validated.",
};

const RECOMMENDATION_TITLES: Record<RouteProtectionGapType, string> = {
  missing_auth: "Add authentication coverage",
  missing_repository_ownership: "Add repository ownership coverage",
  missing_session_ownership: "Add session ownership coverage",
  missing_session_repository_consistency:
    "Add session-to-repository ownership coverage",
  missing_input_validation: "Add input validation coverage",
};

function normalizedRoute(route: RouteProtectionDescriptor): RouteProtectionDescriptor {
  return {
    method: route.method.toUpperCase(),
    path: route.path,
    area: route.area,
    requiresAuth: route.requiresAuth,
    requiresRepositoryOwnership: route.requiresRepositoryOwnership,
    requiresSessionOwnership: route.requiresSessionOwnership,
    requiresSessionRepositoryConsistency: route.requiresSessionRepositoryConsistency,
    hasInputValidation: route.hasInputValidation,
  };
}

function compareRoute(
  a: Pick<RouteProtectionDescriptor, "area" | "method" | "path">,
  b: Pick<RouteProtectionDescriptor, "area" | "method" | "path">,
): number {
  return (
    a.area.localeCompare(b.area) ||
    a.path.localeCompare(b.path) ||
    a.method.localeCompare(b.method)
  );
}

function gapRank(gap: RouteProtectionGapType): number {
  return GAP_ORDER.indexOf(gap);
}

function gapsFor(route: RouteProtectionDescriptor): RouteProtectionGapType[] {
  const gaps: RouteProtectionGapType[] = [];

  if (!route.requiresAuth) gaps.push("missing_auth");
  if (!route.requiresRepositoryOwnership) {
    gaps.push("missing_repository_ownership");
  }
  if (!route.requiresSessionOwnership) gaps.push("missing_session_ownership");
  if (!route.requiresSessionRepositoryConsistency) {
    gaps.push("missing_session_repository_consistency");
  }
  if (!route.hasInputValidation) gaps.push("missing_input_validation");

  return gaps;
}

function emptyGapCounts(): Record<RouteProtectionGapType, number> {
  return {
    missing_auth: 0,
    missing_repository_ownership: 0,
    missing_session_ownership: 0,
    missing_session_repository_consistency: 0,
    missing_input_validation: 0,
  };
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "route";
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return value;

  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  }

  return Object.freeze(value);
}

export function listRouteProtectionGaps(
  routes: readonly RouteProtectionDescriptor[],
): RouteProtectionGap[] {
  const gaps: RouteProtectionGap[] = [];

  for (const route of routes.map(normalizedRoute)) {
    for (const gap of gapsFor(route)) {
      gaps.push({
        method: route.method,
        path: route.path,
        area: route.area,
        gap,
        message: GAP_MESSAGES[gap],
      });
    }
  }

  return gaps.sort(
    (a, b) => compareRoute(a, b) || gapRank(a.gap) - gapRank(b.gap),
  );
}

function buildUnprotectedRoutes(
  routes: readonly RouteProtectionDescriptor[],
): RouteProtectionRouteSummary[] {
  return routes
    .map(normalizedRoute)
    .map((route) => ({
      method: route.method,
      path: route.path,
      area: route.area,
      gaps: gapsFor(route),
    }))
    .filter((route) => route.gaps.length > 0)
    .sort(compareRoute);
}

function buildAreaSummary(
  routes: readonly RouteProtectionDescriptor[],
): RouteProtectionAreaSummary[] {
  const byArea = new Map<string, RouteProtectionAreaSummary>();

  for (const route of routes.map(normalizedRoute)) {
    const routeGaps = gapsFor(route);
    const existing =
      byArea.get(route.area) ??
      {
        area: route.area,
        totalRoutes: 0,
        protectedRoutes: 0,
        unprotectedRoutes: 0,
        gaps: emptyGapCounts(),
      };

    existing.totalRoutes += 1;
    if (routeGaps.length === 0) {
      existing.protectedRoutes += 1;
    } else {
      existing.unprotectedRoutes += 1;
    }

    for (const gap of routeGaps) {
      existing.gaps[gap] += 1;
    }

    byArea.set(route.area, existing);
  }

  return [...byArea.values()]
    .map((area) => ({
      area: area.area,
      totalRoutes: area.totalRoutes,
      protectedRoutes: area.protectedRoutes,
      unprotectedRoutes: area.unprotectedRoutes,
      gaps: { ...area.gaps },
    }))
    .sort((a, b) => a.area.localeCompare(b.area));
}

function buildRecommendations(
  gaps: readonly RouteProtectionGap[],
): RouteProtectionRecommendation[] {
  const counts = new Map<string, { area: string; gap: RouteProtectionGapType; count: number }>();

  for (const gap of gaps) {
    const id = `${gap.area}:${gap.gap}`;
    const existing = counts.get(id) ?? { area: gap.area, gap: gap.gap, count: 0 };
    existing.count += 1;
    counts.set(id, existing);
  }

  return [...counts.values()]
    .map((item) => ({
      id: `${slug(item.area)}.${item.gap}`,
      gap: item.gap,
      area: item.area,
      routeCount: item.count,
      title: RECOMMENDATION_TITLES[item.gap],
      description: `${item.count} ${item.area} route(s) have ${item.gap}.`,
    }))
    .sort(
      (a, b) =>
        a.area.localeCompare(b.area) ||
        gapRank(a.gap) - gapRank(b.gap) ||
        a.id.localeCompare(b.id),
    );
}

export function buildRouteProtectionAudit(
  routes: readonly RouteProtectionDescriptor[],
): RouteProtectionAudit {
  const routeCopies = routes.map(normalizedRoute);
  const gaps = listRouteProtectionGaps(routeCopies);
  const unprotectedRoutes = buildUnprotectedRoutes(routeCopies);

  return deepFreeze({
    totalRoutes: routeCopies.length,
    protectedRoutes: routeCopies.length - unprotectedRoutes.length,
    unprotectedRoutes,
    gaps,
    byArea: buildAreaSummary(routeCopies),
    recommendations: buildRecommendations(gaps),
  });
}
