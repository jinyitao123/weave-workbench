# Weave Workbench

English | [中文](README.zh.md)

Workbench is the product workspace for completing work with agent teams. This repository owns both the browser UI and the TypeScript Host for accounts, conversations, task projections and the product tool bridge. The external Weave platform owns team construction, execution scheduling and final delivery facts.

## Install and run

Use Node.js `^22.19.0 || >=24.0.0` and the pinned `pnpm@11.7.0`. All source dependencies are inside this repository. No adjacent Weave checkout, Go installation or parent Makefile is required.

```sh
pnpm install --frozen-lockfile
pnpm run build:workbench
pnpm workbench --host 127.0.0.1 --port 3080 --no-open
```

Operators supply `WEAVE_API_URL`, a trusted `WEAVE_COMMAND`, and the Host service credential `WEAVE_API_KEY`. The MCP command is a separately delivered, platform-compatible `weave mcp serve` executable; select it through PATH or an explicit executable path. The macOS launcher also supports the existing Keychain service. Users sign in through the browser. User bearer tokens never enter browser storage, and request bodies cannot declare identity.

Members create personal tasks without selecting a directory; the Host assigns their account a private work directory. Administrators manage shared projects and Host settings. A disconnected platform or missing foreground model remains an explicit setup gap. Logging out or restarting the Host invalidates in-memory user authorization.

Keep runtime data, credentials and caches outside source control. `deploy/compose.yaml` is a Workbench-only container example; the platform, database and execution Runtime are deployed separately. Mount a compatible Linux MCP executable read-only. The image does not copy programs from a parent checkout or platform image.

## Develop and verify

```sh
pnpm run check:workbench
```

This gate builds Host and Client types, bundles browser artifacts, checks runtime closure and UI dependencies/copy, and runs the shipped product profile, account/session isolation Host tests and the complete GUI suite. It needs no real model credential. Business delivery acceptance still requires real browser use, identities and models; tests or health responses are not business acceptance.

`pnpm run build` defaults to Workbench. Retained general runtime packages, compatibility names and historical test material do not establish a separate DSH product or release channel. See the [Weave integration boundary](docs/weave-integration.md) and repository [agent guide](AGENTS.md).

## Source and release

- `apps/`: browser application, supported launcher and desktop preview.
- `packages/`: complete interaction Host, account/session services, tools and UI.
- `vendor/`, `native/`, `patches/`: framework source, native isolation and dependency patches required by builds.
- `scripts/`, `snapshots/`: build gates, contracts and regression material.

The migration preserves this private repository's existing Git history and imports the new tree through a normal commit. [MIGRATION.md](MIGRATION.md) records its exact source. Workbench artifacts use this repository's version and commit; the compatible Weave MCP/API baseline is recorded separately. The [MIT license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md) are retained.
