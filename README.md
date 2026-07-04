# Giro.gtdev

AI-powered Engineering Intelligence Platform for GitHub repositories.

Giro helps developers understand large codebases faster by building deterministic repository intelligence before passing curated context to an LLM.

## Why Giro?

Modern AI coding tools are powerful, but they often struggle with repository-level understanding.

Giro focuses on the layer before generation:


Repository
↓
Structure Analysis
↓
Architecture Analysis
↓
Symbol Extraction
↓
Dependency Graph
↓
Hybrid Retrieval
↓
Context Assembly
↓
Grounded AI Answers


 ## Core Idea

Giro is not trying to replace coding assistants.

It is building the intelligence layer that helps AI tools understand codebases better.

Features
Repository ingestion
Repository structure analysis
Architecture intelligence
Symbol extraction
Dependency graph analysis
Hybrid retrieval
Context assembly
Repository-aware sessions
Cleanup lifecycle
Dashboard-ready backend APIs
Deterministic tests
Current Status

Backend core is active and evolving.

Repository intelligence: complete
Retrieval engine: mostly complete
Architecture intelligence: complete
Incremental indexing: active
Repository cleanup lifecycle: in progress
Frontend: upcoming
Tech Stack
TypeScript
Hono
Node.js
Zod
PostgreSQL / pgvector planned
Redis / background workers planned
Next.js frontend planned
Roadmap
Complete repository cleanup lifecycle
Add background indexing workers
Add persistence layer
Add pgvector integration
Build frontend dashboard
Add retrieval inspector UI
Deploy live demo
Vision

The goal is to make Giro the engineering intelligence layer for modern AI-assisted software development.

Instead of asking an LLM to guess from limited context, Giro first understands the repository, then helps the model answer with grounded context.

Built by

Gatik Tulsiani

Building in public.
