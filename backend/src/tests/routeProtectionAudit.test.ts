import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRouteProtectionAudit,
  listRouteProtectionGaps,
  type RouteProtectionDescriptor,
} from "../services/security/routeProtectionAudit.js";

function route(
  overrides: Partial<RouteProtectionDescriptor> = {},
): RouteProtectionDescriptor {
  return {
    method: "GET",
    path: "/repos/:owner/:repo",
    area: "repositories",
    requiresAuth: true,
    requiresRepositoryOwnership: true,
    requiresSessionOwnership: true,
    requiresSessionRepositoryConsistency: true,
    hasInputValidation: true,
    ...overrides,
  };
}

test("fully protected route has no gaps", () => {
  const audit = buildRouteProtectionAudit([route()]);

  assert.equal(audit.totalRoutes, 1);
  assert.equal(audit.protectedRoutes, 1);
  assert.deepEqual(audit.unprotectedRoutes, []);
  assert.deepEqual(audit.gaps, []);
  assert.deepEqual(audit.recommendations, []);
});

test("missing auth is reported as missing_auth", () => {
  const gaps = listRouteProtectionGaps([
    route({ requiresAuth: false, path: "/sessions" }),
  ]);

  assert.deepEqual(gaps.map((gap) => gap.gap), ["missing_auth"]);
  assert.equal(gaps[0]?.method, "GET");
  assert.equal(gaps[0]?.path, "/sessions");
});

test("missing repository ownership is reported", () => {
  const audit = buildRouteProtectionAudit([
    route({
      path: "/repos/:owner/:repo/dependencies",
      requiresRepositoryOwnership: false,
    }),
  ]);

  assert.deepEqual(audit.gaps.map((gap) => gap.gap), [
    "missing_repository_ownership",
  ]);
  assert.deepEqual(audit.unprotectedRoutes[0]?.gaps, [
    "missing_repository_ownership",
  ]);
});

test("missing session ownership and session-repository consistency are reported", () => {
  const audit = buildRouteProtectionAudit([
    route({
      area: "sessions",
      path: "/sessions/:sessionId/ask",
      method: "POST",
      requiresSessionOwnership: false,
      requiresSessionRepositoryConsistency: false,
    }),
  ]);

  assert.deepEqual(audit.gaps.map((gap) => gap.gap), [
    "missing_session_ownership",
    "missing_session_repository_consistency",
  ]);
});

test("missing validation is reported", () => {
  const audit = buildRouteProtectionAudit([
    route({
      method: "POST",
      path: "/retrieval/hybrid",
      area: "retrieval",
      hasInputValidation: false,
    }),
  ]);

  assert.deepEqual(audit.gaps.map((gap) => gap.gap), [
    "missing_input_validation",
  ]);
  assert.equal(audit.recommendations[0]?.id, "retrieval.missing_input_validation");
});

test("grouped area summary is stable and counts gaps", () => {
  const audit = buildRouteProtectionAudit([
    route({ area: "sessions", path: "/sessions" }),
    route({
      area: "repositories",
      path: "/repos/connect",
      method: "POST",
      requiresAuth: false,
      requiresRepositoryOwnership: false,
    }),
    route({
      area: "repositories",
      path: "/repos/search",
      requiresRepositoryOwnership: false,
      hasInputValidation: false,
    }),
  ]);

  assert.deepEqual(audit.byArea.map((area) => area.area), [
    "repositories",
    "sessions",
  ]);

  assert.deepEqual(audit.byArea[0], {
    area: "repositories",
    totalRoutes: 2,
    protectedRoutes: 0,
    unprotectedRoutes: 2,
    gaps: {
      missing_auth: 1,
      missing_repository_ownership: 2,
      missing_session_ownership: 0,
      missing_session_repository_consistency: 0,
      missing_input_validation: 1,
    },
  });

  assert.deepEqual(audit.byArea[1], {
    area: "sessions",
    totalRoutes: 1,
    protectedRoutes: 1,
    unprotectedRoutes: 0,
    gaps: {
      missing_auth: 0,
      missing_repository_ownership: 0,
      missing_session_ownership: 0,
      missing_session_repository_consistency: 0,
      missing_input_validation: 0,
    },
  });
});

test("deterministic ordering is by area, path, method, then gap rank", () => {
  const audit = buildRouteProtectionAudit([
    route({
      area: "sessions",
      method: "POST",
      path: "/sessions/:sessionId/ask",
      requiresSessionOwnership: false,
      hasInputValidation: false,
    }),
    route({
      area: "repositories",
      method: "POST",
      path: "/repos/connect",
      requiresAuth: false,
      requiresRepositoryOwnership: false,
      hasInputValidation: false,
    }),
    route({
      area: "repositories",
      method: "GET",
      path: "/repos/connect",
      requiresAuth: false,
    }),
  ]);

  assert.deepEqual(
    audit.gaps.map((gap) => `${gap.area} ${gap.path} ${gap.method} ${gap.gap}`),
    [
      "repositories /repos/connect GET missing_auth",
      "repositories /repos/connect POST missing_auth",
      "repositories /repos/connect POST missing_repository_ownership",
      "repositories /repos/connect POST missing_input_validation",
      "sessions /sessions/:sessionId/ask POST missing_session_ownership",
      "sessions /sessions/:sessionId/ask POST missing_input_validation",
    ],
  );

  assert.deepEqual(audit.recommendations.map((item) => item.id), [
    "repositories.missing_auth",
    "repositories.missing_repository_ownership",
    "repositories.missing_input_validation",
    "sessions.missing_session_ownership",
    "sessions.missing_input_validation",
  ]);
});

test("input descriptors are not mutated and output is immutable", () => {
  const routes = [
    route({
      method: "post",
      path: "/sessions",
      area: "sessions",
      requiresAuth: false,
    }),
  ];
  const before = structuredClone(routes);

  const audit = buildRouteProtectionAudit(routes);

  assert.deepEqual(routes, before);
  assert.equal(Object.isFrozen(audit), true);
  assert.equal(Object.isFrozen(audit.gaps), true);
  assert.equal(Object.isFrozen(audit.byArea[0]), true);
  assert.equal(audit.gaps[0]?.method, "POST");
});

test("empty route list returns empty audit", () => {
  const audit = buildRouteProtectionAudit([]);

  assert.deepEqual(audit, {
    totalRoutes: 0,
    protectedRoutes: 0,
    unprotectedRoutes: [],
    gaps: [],
    byArea: [],
    recommendations: [],
  });
});
