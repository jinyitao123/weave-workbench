import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ProjectCenterPage } = await import('../src/pages/project-center.page.ts');
const cliRequire = createRequire(require.resolve('@objectstack/cli'));
const { transformSync } = cliRequire('esbuild');

assert.equal(ProjectCenterPage.kind, 'react');
transformSync(ProjectCenterPage.source, { loader: 'jsx', format: 'esm', sourcefile: 'page_project_center.jsx' });
assert.match(ProjectCenterPage.source, /safeFind\('sys_user',\{banned:\{\$ne:true\}\}\)/, 'manager candidates query only fields declared by sys_user');
assert.doesNotMatch(ProjectCenterPage.source, /safeFind\('sys_user',\{active:/, 'an undeclared active field must not make the project detail lookup fail');
assert.match(ProjectCenterPage.source, /taskPriorityText\[x\.priority\]\|\|'—'/, 'task priority reads the task field and leaves legacy null values visible as missing');
assert.doesNotMatch(ProjectCenterPage.source, /x\.critical_path\?'高':'中'/, 'task priority is never inferred from critical-path status');
assert.match(ProjectCenterPage.source, /page_goodwill_orders\?'.*new URLSearchParams\(\{project:projectId,create:'true'\}\)/, 'project Goodwill launch carries both the project context and create intent');
assert.match(ProjectCenterPage.source, /x\.gift_type_name\|\|goodwillGiftText\[x\.gift_type\]/, 'Goodwill list prefers its persisted Chinese gift name');
assert.match(ProjectCenterPage.source, /goodwillStatusText\[x\.status\]\|\|'—'/, 'Goodwill list renders known statuses in Chinese');
assert.match(ProjectCenterPage.source, /readFailure\('forge_goodwill_order'\)\?'Goodwill 订单读取失败，无法确认记录'/, 'a denied Goodwill read is not shown as an empty project list');
assert.match(ProjectCenterPage.source, /systemPermissions\?\.includes\('sales_goodwill_operator'\).*新建 Goodwill 订单/, 'Goodwill creation is only offered to an authorized operator');
assert.doesNotMatch(ProjectCenterPage.source, /pc-plan-recommended|<p>选择计划来源并设置开始日期/, 'plan template options do not show a recommendation badge or generic instruction');
assert.match(ProjectCenterPage.source, /page_delivery_acceptance_workspace\?type=package&id=/, 'delivery package rows have a direct record-detail route');
assert.ok(ProjectCenterPage.source.includes("function bomWorkspaceHref(bomId){const query=new URLSearchParams({project:projectId});if(bomId)query.set('id',bomId);return '/apps/com.inoforge.forge.supply-chain/page_bom_workspace?'+query.toString();}"), 'BOM routes carry selected project and optional record context');
assert.doesNotMatch(ProjectCenterPage.source, /headers=\['任务编号'/, 'project detail does not expose plan-derived internal item keys');
assert.doesNotMatch(ProjectCenterPage.source, /x\.item_key\|\|'—'/, 'project detail does not render the plan id composite as a task number');
const { ProjectAttachmentPanelSource } = await import('../src/pages/project-attachment-panel.ts');
assert.doesNotMatch(ProjectAttachmentPanelSource, /拖拽文件到此处上传|Ctrl\+V 粘贴截图/, 'project attachment UI does not advertise missing upload gestures');
assert.match(ProjectCenterPage.source, /<ProjectAttachmentPanel projectId=\{projectId\}.*canUpload=\{state\.permissions\.systemPermissions\?\.includes\('forge_project_work_member'\)\|\|state\.permissions\.systemPermissions\?\.includes\('forge_project_manager'\)\}/, 'project attachment upload uses the controlled member/manager panel, not generic object create permission');
process.stdout.write('PASS page_project_center embedded React source parses\n');
