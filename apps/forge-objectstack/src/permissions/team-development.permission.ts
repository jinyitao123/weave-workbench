import { definePermissionSet } from '@objectstack/spec';

/**
 * Grants access to Weave's team-development surface after Forge sign-in.
 *
 * The set intentionally carries no Forge data permission. Forge business
 * records and actions remain governed by their own permission sets.
 */
export const weaveTeamDeveloperPermission = definePermissionSet({
  name: 'weave_team_developer',
  label: '智能体团队开发',
  description: '允许在桌面端配置、调试和发布智能体团队。',
  objects: {},
});
