import { servicePerformanceCustomerReferenceId } from './sales-service-performance-customers.panel.js';

export function serviceOrderSourceKey(values: Record<string, unknown> = {}) {
  return JSON.stringify([
    servicePerformanceCustomerReferenceId(values.customer_id),
    servicePerformanceCustomerReferenceId(values.sales_order_id),
  ]);
}

export function serviceOrderAddressValue(record: Record<string, unknown>, field: string) {
  if (!Object.prototype.hasOwnProperty.call(record, field)) return null;
  const value = record[field];
  return value == null ? '' : typeof value === 'string' ? value.trim() : null;
}

/** Read only the selected native records; no writes or expanded permissions. */
export async function readServiceOrderAddress(
  read: (objectName: string, id: string) => Promise<Record<string, unknown>>,
  customerId: string,
  orderId: string,
) {
  if (!customerId) return { value: '', error: '' };
  try {
    const [customer, order] = await Promise.all([
      read('forge_customer', customerId),
      orderId ? read('forge_sales_order', orderId) : Promise.resolve(null),
    ]);
    if (servicePerformanceCustomerReferenceId(customer.id) !== customerId
      || (order && servicePerformanceCustomerReferenceId(order.id) !== orderId)) {
      return { value: '', error: '来源信息读取不完整，请手动填写服务地址。' };
    }
    if (order && servicePerformanceCustomerReferenceId(order.customer_id) !== customerId) {
      return { value: '', error: '客户与来源订单不匹配，服务地址未自动填写。' };
    }
    const delivery = order ? serviceOrderAddressValue(order, 'delivery_address') : '';
    if (delivery === null) return { value: '', error: '订单服务地址暂不可读取，请手动填写。' };
    if (delivery) return { value: delivery, error: '' };
    const fallback = serviceOrderAddressValue(customer, 'address');
    if (fallback === null) return { value: '', error: '客户服务地址暂不可读取，请手动填写。' };
    return { value: fallback, error: fallback ? '' : '所选来源未填写服务地址，请手动填写。' };
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === 401) return { value: '', error: '登录状态已失效，请重新登录后核对服务地址。' };
    if (status === 403) return { value: '', error: '当前账号无权读取服务地址，请手动填写。' };
    return { value: '', error: '服务地址读取失败，请手动填写或重新选择来源。' };
  }
}

export const serviceOrderSourceHelpersSource = [serviceOrderSourceKey, serviceOrderAddressValue, readServiceOrderAddress]
  .map(helper => helper.toString()).join('\n');
