import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [salesObject, projectObject, salesActions, projectActions, orderCreate, orderWorkspace, contractCreate, projectCenter, orderPermission, projectPermission, navigation, quotationFlow, quotationPage, contractFlow, productUi] = await Promise.all([
  read('../src/objects/sales.object.ts'), read('../src/objects/project.object.ts'),
  read('../src/actions/sales.action.ts'), read('../src/actions/project.action.ts'),
  read('../src/pages/sales-order-create.page.ts'), read('../src/pages/sales-order-workspace.page.ts'),
  read('../src/pages/sales-contract-create.page.ts'), read('../src/pages/project-center.page.ts'),
  read('../src/permissions/sales-order.permission.ts'), read('../src/permissions/project-operator.permission.ts'),
  read('../src/apps/application-navigation.json'), read('../src/flows/sales-quotation-approval.flow.ts'),
  read('../src/pages/sales-crm-service-pages.page.ts'), read('../src/flows/sales-contract-approval.flow.ts'),
  read('../src/pages/product-ui.ts'),
]);

assert.match(salesObject, /export const SalesContractLine[\s\S]*?line_type: choice\('明细类型', \['物料', '服务项目'\][\s\S]*?sku_id: reference\('forge_material_sku', '物料规格'\),/);
assert.match(salesObject, /export const SalesOrderLine[\s\S]*?line_type: choice\('明细类型', \['物料', '服务项目'\][\s\S]*?sku_id: reference\('forge_material_sku', '物料规格'\),[\s\S]*?controlled_by_parent/);

const contractOrderSource = orderCreate.split('const contractOrderCreateSource = String.raw')[1] ?? '';
const projectCenterDetailSource = projectCenter.split('const projectDetailV2Runtime = String.raw')[1] ?? '';
assert.match(contractOrderSource, /const listUrl=forgePageHref\('page_sales_order_workspace'\)/);
assert.doesNotMatch(contractOrderSource, /const listUrl='\/_console/);
assert.match(contractOrderSource, /if\(listUrl\)window\.location\.href=listUrl/);
assert.match(contractOrderSource, /fp-page-header contract-create-title/);
assert.match(contractOrderSource, /fp-card contract-section"><ForgeEmpty title="暂无可用于下单的合同"/);
assert.match(contractOrderSource, /\$\{forgeProductUiRuntime\}/);

assert.match(salesActions, /name: 'sales_contract_draft_create'[\s\S]*?requiredPermissions: \['sales_contract_operator'\][\s\S]*?api\.transaction/);
assert.match(salesActions, /const lineType = source \? source\.line_type/);
assert.match(salesActions, /if \(record\.quotation_id\)[\s\S]*?quote\.status !== 'accepted'[\s\S]*?提交合同前必须明确付款条件/);
assert.match(salesActions, /signed_on: null, starts_on: ctx\.input\.starts_on/);
assert.match(salesActions, /name: 'contract_convert_to_sales_order'[\s\S]*?requiredPermissions: \['sales_order_operator'\][\s\S]*?api\.transaction/);
assert.match(salesActions, /仅完成内部审批并归档客户签署凭证的合同可以创建销售订单/);
assert.match(salesActions, /responsible_id: actor/);
assert.match(salesActions, /line_type: line\.line_type \|\| 'material'[\s\S]*?sku_id: line\.sku_id \|\| null/);
assert.match(salesActions, /const orderLine = orderLines\.find\(line => line\.id === ctx\.input\.order_line_id\)/);
assert.match(salesActions, /服务项目不进入库存或发货单，请选择订单中的物料行/);
assert.doesNotMatch(salesActions, /含服务项目的混合订单暂不支持发货/);
assert.match(salesActions, /name: 'contract_register_signature'[\s\S]*?signed_evidence_attachment[\s\S]*?sys_file/);
assert.match(salesActions, /signed_on: null, signed_evidence_attachment: null/);
assert.match(salesActions, /name: 'quotation_submit'[\s\S]*?submitted_pricing_version: version[\s\S]*?status: 'pending_approval'/);
assert.match(salesActions, /name: 'quotation_send'[\s\S]*?sent_evidence_attachment[\s\S]*?sent_pricing_version: version/);
assert.match(salesActions, /name: 'quotation_accept'[\s\S]*?customer_acceptance_evidence_attachment[\s\S]*?accepted_pricing_version: version/);
assert.doesNotMatch(salesActions, /export const QuotationApprove =/);
assert.doesNotMatch(salesActions, /payment_method: 'bank_transfer'/);

assert.match(orderPermission, /name: 'sales_order_operator'/);
assert.match(orderPermission, /status == 'active' && signed_on != null && signed_evidence_attachment != null/);
assert.match(projectPermission, /owner_id == current_user\.id \|\| \(owner_id == null && created_by == current_user\.id\) \|\| manager_id == current_user\.id/);
assert.doesNotMatch(projectPermission, /forge_customer\s*:/);
assert.doesNotMatch(projectPermission, /forge_sales_order_line\s*:/);
assert.match(projectActions, /const actor = ctx\.session && ctx\.session\.userId;[\s\S]*?owner_id: actor/);
assert.match(projectActions, /name: 'project_refresh_customer_snapshot'[\s\S]*?requiredPermissions: \['forge_project_operator', 'sales_contract_operator'\][\s\S]*?project\.created_by !== actor[\s\S]*?customer\.owner_id[\s\S]*?customer_name_snapshot: customerName/);
assert.match(projectActions, /where: \{ id: project\.customer_id \}, fields: \['id', 'name', 'owner_id'\]/);
assert.match(projectActions, /name: 'project_read_delivery_scope'[\s\S]*?requiredPermissions: \['forge_project_operator'\][\s\S]*?ctx\.recordLoadDenied === true[\s\S]*?forge_project_sales_link[\s\S]*?forge_sales_order_line[\s\S]*?accepted_pricing_version[\s\S]*?trace_consistent/);
assert.match(projectObject, /customer_name_snapshot/);
assert.match(projectObject, /contract_code_snapshot[\s\S]*?order_status_snapshot/);
assert.match(projectObject, /forge_project_member'[\s\S]*?controlled_by_parent/);

assert.match(orderCreate, /当前账号没有销售订单经办权限/);
assert.match(orderCreate, /contractOrderCreateSource = String\.raw`[\s\S]*?export default App;/);
assert.match(orderCreate, /status==='active'&&Boolean\(item\.signed_on\)/);
assert.match(orderCreate, /Boolean\(item\.signed_evidence_attachment\)/);
assert.match(orderCreate, /payment_method:''/);
assert.match(orderCreate, /不进入库存与发货/);
assert.match(orderWorkspace, /const href=forgePageHref\('page_sales_order_create'\);if\(href\)window\.location\.href=href/);
assert.match(productUi, /"page_sales_order_create": "com\.inoforge\.forge\.sales"/);
assert.doesNotMatch(orderWorkspace, /forge_sales_order\/new/);
assert.match(orderWorkspace, /shipmentAllowed\(order\)/);
assert.match(orderWorkspace, /order_line_id:current\.order_line_id/);
assert.match(orderWorkspace, /dialog\.orderLines\.map/);

assert.match(contractCreate, /line\.line_type==='service'/);
assert.match(contractCreate, /sales_contract_draft_create/);
assert.match(salesActions, /来源报价明细的名称、规格、数量和价税必须保持原值/);
assert.match(projectCenter, /request\('\/auth\/me\/permissions'\)/);
assert.match(projectCenter, /项目数据或当前权限读取失败/);
assert.match(projectCenter, /planned_start_on:'',planned_end_on:''/);
assert.match(projectCenter, /addEventListener\('popstate'/);
assert.match(projectCenter, /removeEventListener\('popstate'/);
assert.match(projectCenter, /customer_name_snapshot/);
assert.match(projectCenter, /request\('\/auth\/get-session'\)/);
assert.match(projectCenter, /project_refresh_customer_snapshot/);
assert.match(projectCenter, /project_read_delivery_scope/);
assert.match(projectCenter, /来源报价\/核价版本/);
assert.match(projectCenter, /服务项目不进入库存或发货/);
assert.match(projectCenter, /trace_consistent/);
assert.match(projectCenter, /tax_amount/);
assert.match(projectCenter, /项目类型/);
assert.match(projectCenter, /预计营收（销售预测）/);
assert.match(projectCenter, /errorStatus===401/);
assert.match(projectCenter, /errorStatus===403/);
assert.match(projectCenter, /tabReadFailures/);
assert.match(projectCenterDetailSource, /tabReadFailures=/);
assert.match(projectCenterDetailSource, /canRefreshCustomerSnapshot=/);
assert.match(projectCenter, /关联订单读取失败，当前无法确认关联状态/);
assert.match(projectActions, /requiredPermissions: \['forge_project_operator', 'sales_contract_operator'\]/);
assert.match(projectActions, /order_status_snapshot: order\.status/);
assert.match(projectActions, /contract\.status !== 'active' \|\| !contract\.signed_on \|\| !contract\.signed_evidence_attachment/);
assert.match(quotationFlow, /type: 'approval'[\s\S]*?value: 'sales_quotation_reviewer'/);
assert.match(salesActions, /未配置销售报价审批岗/);
assert.match(quotationPage, /提交审批/);
assert.match(quotationPage, /登记已发送/);
assert.match(quotationPage, /记录客户接受/);
assert.match(quotationPage, /此处只登记员工已实际完成的发送，不会替你发送邮件或消息/);
assert.match(quotationPage, /凭证必须对应当前已发送的核价版本/);
assert.match(quotationPage, /（待核实）/);
assert.match(contractFlow, /取得客户签署版后，请登记签署日期和凭证/);
assert.match(navigation, /"id": "sales_orders"[\s\S]*?"requiredPermissions": \[[\s\S]*?"sales_order_operator"/);
assert.match(navigation, /"id": "projects"[\s\S]*?"requiredPermissions": \[[\s\S]*?"forge_project_operator"/);

console.log('PASS sales-to-project handoff source and authorization invariants');
