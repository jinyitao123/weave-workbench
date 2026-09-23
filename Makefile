.PHONY: check status component-check release-check desktop-check weave-check forge-check

check:
	@node tools/check-layout.mjs
	@node --test tools/project-status.test.mjs
	@node --test tools/documentation-policy.test.mjs

status:
	@node tools/project-status.mjs

component-check:
	@node tools/project-status.mjs --check-components

release-check: check
	@node tools/project-status.mjs --check-release

desktop-check:
	@cd desktop && npm run typecheck && npm run check && npm test

weave-check:
	@$(MAKE) -C platform/weave test depguard base-depguard

forge-check:
	@cd platform/forge/apps/forge-objectstack && pnpm typecheck && pnpm validate
