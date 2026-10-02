# Security Policy

## Supported versions

This project is in a pilot stage (see the [README](README.md#项目状态--status)). Security fixes are made on `main` and in the source repositories of each component; there are no long-term support branches yet.

## Report a vulnerability

Do not disclose suspected vulnerabilities in a public issue, discussion, or pull request.

1. Open the [private vulnerability report form](https://github.com/jinyitao123/weave-workbench/security/advisories/new).
2. Describe the affected component (`desktop/`, `platform/weave/`, `platform/forge/`, `contracts/`), the impact, and the steps to reproduce.
3. Keep follow-up discussion inside the advisory.

If the form is unavailable, open a public issue titled `[Security] Private reporting unavailable` without any vulnerability details and ask a maintainer to enable it.

We aim to acknowledge a report within 5 business days and to give a first assessment within 10 business days. Please keep the report confidential until a fix is available; we coordinate disclosure with the reporter, normally within 90 days.

## Scope

In scope: identity and session handling, task delegation, material and file access, business-action authorization, audit records, and secret handling across the desktop client, Weave, Forge, and the shared contracts.

Out of scope: findings that need a modified client or already-compromised host, denial of service through volume alone, and issues in third-party dependencies that have no reachable path in this project (report those upstream).

## Credentials in this repository

This repository must never contain real passwords, tokens, API keys, or private keys. If you find one, report it through the private form above instead of opening an issue. Test accounts used in documentation list roles and permissions only; passwords are kept outside Git.

Component-specific policies: [desktop](desktop/.github/SECURITY.md).
