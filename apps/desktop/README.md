---
description: "Run the macOS desktop product backed by a real local Workbench Host."
kind: "package-reference"
---

# Weave Workbench desktop

English | [中文](README.zh.md)

Electron is the supported Workbench product entry. On startup it launches a local Workbench Host in the application's own data directory and loads the Host's one-time authenticated URL. Users then sign in through the normal account page. Platform tokens remain in Host memory; the window holds only an HttpOnly session cookie. User and workspace identity come from the platform login response, with no service URL or workspace identifier exposed in the product flow.

```sh
pnpm install --frozen-lockfile
pnpm run build:workbench
pnpm run desktop:dev
pnpm run desktop:test
```

`desktop:dev` starts the real desktop product. It reads `WEAVE_API_URL` and `WEAVE_API_KEY`; on macOS the Host key can also come from the `weave-workbench-api-key` Keychain service. The default data directory is `~/Library/Application Support/Weave Workbench`. Closing the app stops the Host it started.

The product window retains the normal Workbench pages and permission boundary, including account login, project selection, Sessions, settings and execution surfaces. The renderer has no Node, filesystem or shell capability. The Host owns platform identity, workspace ownership, Sessions, tools and model settings.

`--fixture-preview` is an explicit shell regression mode. Its synthetic service-selection scenario is not a product entry and is not evidence for accounts, projects or business execution. `desktop:test` runs that shell regression and then starts a real Host, signs in through the normal product route, and verifies the project picker, account menu and settings navigation.

The source-based desktop path now uses the real Host. The existing `desktop:package` does not yet embed the complete Host runtime, so its output is not a distributable product build. Runtime staging, signing and notarization remain release work.
