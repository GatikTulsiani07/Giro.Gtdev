# Security Policy

Security reports are welcome and should be handled privately.

## Supported Versions

Giro is preparing for its first public alpha. Until the first tagged release, security fixes target the `main` branch.

## Reporting a Vulnerability

Please do not open a public issue for a vulnerability.

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not enabled yet, wait for a maintainer security contact to be published before sharing exploit details. A useful report includes:

- Affected component.
- Impact.
- Reproduction steps.
- Logs or request IDs if safe to share.
- Suggested mitigation, if known.

## Sensitive Data

Do not include real secrets, access tokens, service-role keys, private repository source, or customer data in issues, pull requests, logs, or screenshots.

## Security-Relevant Areas

- Bearer JWT authentication.
- Repository ownership and authorization boundaries.
- Repository checkout and filesystem access.
- Supabase service-role usage.
- Indexing worker leases and claims.
- Retrieval evidence and source snippets.
- Frontend token storage.
