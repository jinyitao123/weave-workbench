# Weave integration boundary

English | [中文](weave-integration.zh.md)

Workbench owns the browser and TypeScript interaction Host. It communicates with an external Weave platform through `/v1` HTTP APIs and an operator-installed `weave mcp serve` command. No Go source, platform database, task queue or parent checkout is required to install, build or test Workbench.

## Compatibility baseline

The first independent source baseline is imported from Weave commit `9fc21c4da70fb59ba1f36d92b21b1be148259662`. Its MCP executable and platform API must support the same account delegation, bound-dispatch input revision, task action and delivery contracts. Use a matched versioned Weave build; this baseline does not claim compatibility with arbitrary historical or future releases. Record executable version/checksum, platform version and Workbench commit in deployment evidence. HTTP `/v1` identifies the API generation; a successful connection alone is not compatibility acceptance.

## Operator inputs

| Input | Responsibility |
| --- | --- |
| `WEAVE_API_URL` | Reachable external platform API base URL |
| `WEAVE_COMMAND` | Trusted, version-matched MCP executable; invoked with `mcp serve` |
| `WEAVE_API_KEY` | Host service credential, retained outside browser and model input |
| Browser platform account | Verified user authorization, bound to every Session and MCP request |
| `DSH_HOME` | Host runtime data directory, outside source control |

The Host uses `X-Weave-User-Authorization` for delegated HTTP calls and the corresponding authenticated MCP request metadata. Identity is verified server-side; user claims in task text or request bodies have no authority. Missing user authorization must never fall back to the Host service identity. Host restart and sign-out invalidate active user grants.

## Deployment boundary

The standalone Dockerfile builds this repository only. It does not build Go or copy from a Weave platform image. `deploy/compose.yaml` mounts an independently obtained Linux MCP executable read-only and connects to an external API. Match the executable to the container architecture. Keep production secrets and operator `.env` files outside Git; `deploy/.env.example` contains placeholders only.

Team dispatch remains a Weave durable task. The Workbench foreground conversation, background observation and UI projections do not own platform claims, retries, deadlines, budgets, cancellation acknowledgements or final delivery state. Real acceptance covers two accounts on one Host, logout/expiry, ordinary personal task creation, exact-run delivery and the configured runtime/model combination.
