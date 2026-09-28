# Online Education Management Platform

This workspace contains the architecture and planning package for the education management platform described in the source specification.

## Documents

- [requirements-analysis.md](requirements-analysis.md) — requirement breakdown, dependencies, ambiguities, assumptions, and implementation roadmap.
- [phase-1-architecture.md](phase-1-architecture.md) — technology stack, architecture, database design, RBAC, API outline, frontend pages, and phased delivery plan.

## Status

Implementation is underway. The current foundation includes a .NET 9 API, SQLite development persistence, PostgreSQL production support, signed JWT authentication, role-protected controllers, rate limiting, and a Next.js workspace with login and dashboard flows.

See [production-readiness.md](production-readiness.md) for environment configuration and deployment requirements.
