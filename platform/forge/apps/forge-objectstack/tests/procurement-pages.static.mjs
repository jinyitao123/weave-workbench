import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../src/pages/${file}`, import.meta.url), 'utf8');
const [requestPage, approvalsPage, todoPage, inquiryPage, orderPage] = await Promise.all([
  read('purchase-request.page.ts'),
  read('approval-center.page.ts'),
  read('purchase-todo-pool.page.ts'),
  read('purchase-inquiry.page.ts'),
  read('purchase-order-workspace.page.ts'),
]);

assert.match(requestPage, /前往我的审批/);
assert.doesNotMatch(requestPage, />通过<\/button>.*>驳回<\/button>/s);
assert.doesNotMatch(requestPage, /采购管理 \/ 采购申请<\/strong>/);
assert.match(requestPage, /申请日期起（含）/);
assert.match(requestPage, /申请日期止（含）/);
assert.match(requestPage, /nth-last-child\(3\).*position:sticky/);
assert.match(approvalsPage, /procurement_approval_task_decide/);
assert.match(approvalsPage, /来源单据/);
assert.match(todoPage, /page_purchase_inquiry\?pending=/);
assert.match(inquiryPage, /new URLSearchParams\(location\.search\)\.get\('pending'\)/);
assert.match(inquiryPage, /inquiry_id:inquiryId,status:'inquiring'/);
assert.match(inquiryPage, /采购待办已回写/);
assert.match(inquiryPage, /未下单物料已返回采购待办/);
assert.match(inquiryPage, /approval_status==='approved'/);
assert.match(inquiryPage, /purchase_order_submit/);
assert.match(orderPage, /page_purchase_arrival_notice'\}>到货通知/);
assert.doesNotMatch([requestPage, approvalsPage, todoPage, inquiryPage, orderPage].join('\n'), /window\.(alert|confirm|prompt)\s*\(/);

console.log('PASS procurement pages expose real approval and pending-to-inquiry workflows');
