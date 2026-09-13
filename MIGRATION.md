# Workbench source import

- Source repository: https://github.com/jinyitao123/weave-next
- Source commit: `9fc21c4da70fb59ba1f36d92b21b1be148259662`
- Imported path: `workbench/`
- Existing Workbench main ancestor: `c595de007b7b4e26cb81d5831e3d983341d913ff`
- Import branch: `codex/split-workbench-20260914`

The existing repository was cloned normally. Its tracked tree was replaced with the committed source subtree through ordinary deletion, copying and a new commit. The previous main commit remains an ancestor; no history was rewritten and no force push is required. Generated dependencies, bundles and caches are outside the import.

The standalone adjustment owns root README/AGENTS, the independent product check and CI, repository-relative deployment, removal of obsolete upstream Python release CI, and three runtime-brand labels routed through existing locale keys. The full TypeScript Host and browser package closure is retained. Existing package identifiers and licenses are preserved to avoid mixing package renaming with repository separation.

This source import is a development baseline, not a business acceptance or production release. Record the final standalone commit and the matched Weave MCP/API build when validating or deploying it.
