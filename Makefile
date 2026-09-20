.PHONY: check desktop-check weave-check forge-check

check:
	@node tools/check-layout.mjs

desktop-check:
	@cd desktop && npm run typecheck && npm run check && npm test

weave-check:
	@$(MAKE) -C platform/weave test

forge-check:
	@cd platform/forge && pnpm check

