# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| latest on `main` | ✅ |

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** on this repository — never a
public issue for security-relevant reports.

## By design (not vulnerabilities)

- tape is offline by default. If a feature talks to the network, it is
  documented in the README; anything beyond that is a bug worth reporting.
- Files under the user's home are read/modified only where the README says so.

## Data handling

No telemetry. No uploads. If a future feature adds either, it will be opt-in
and documented here.
