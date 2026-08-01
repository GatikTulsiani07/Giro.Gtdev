# Product Documentation

Giro is a repository intelligence platform for software teams using AI-assisted engineering workflows.

## Repository Intelligence

Repository Intelligence is the structured understanding Giro builds from a codebase: files, architecture, dependencies, symbols, features, diagnostics, metadata, and evidence. It exists so engineers can inspect facts before asking for AI-generated explanations or plans.

## Engineering Sessions

Engineering Sessions are persistent workspaces tied to a repository and revision. A session stores context, conversation events, engineering outputs, diagnostics, evidence, and workflow state. Sessions can be reopened so work continues from the same repository context.

## Feature Intelligence

Feature Intelligence groups repository behavior into product or engineering features. It can expose ownership, entry points, exit points, related APIs, related files, related symbols, upstream relationships, downstream relationships, and dependencies when the backend returns them.

## Semantic Intelligence

Semantic Intelligence helps developers navigate code relationships. It supports definitions, references, implementations, callers, callees, inheritance, hierarchy, dependencies, and related metadata through the semantic gateway.

## Query Engine

The Query Engine takes a repository-scoped question or action and routes it through repository context, retrieval, ranking, confidence, and response generation. The goal is grounded output with inspectable evidence rather than unsupported answers.

## Insights

Insights expose backend findings about repository hotspots, coupling, architecture, features, dependencies, and other available repository signals. The frontend does not invent insights; it renders existing backend data.

## Evolution

Evolution summarizes how the repository changes over time when the backend has enough historical information. It can help engineers understand stable areas, growth, risk, and architectural drift.

## Workspace

The Repository Workspace is the main product surface. It includes:

- Left panel: session history, repository navigation, pinned context.
- Center panel: conversation, overview, architecture, feature explorer, symbol explorer, file viewer.
- Right panel: evidence, metadata, diagnostics, workflow, relationships.
- Global search and command palette.
- URL state for views, files, features, symbols, sessions, evidence, and workflows.

The workspace is designed for developers who need to move between repository facts and AI-assisted engineering outputs without losing context.
