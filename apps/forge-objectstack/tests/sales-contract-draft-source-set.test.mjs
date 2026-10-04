import assert from 'node:assert/strict';
import test from 'node:test';
import { SalesContractDraftCreate } from '../src/actions/sales.action.ts';
import { hasExactQuotationLineSet } from '../src/actions/sales-contract-source-set.ts';

test('a sourced contract draft requires the exact quotation-line ID set', () => {
  const quotationLines = [{ id: 'quote-service' }, { id: 'quote-material' }];
  const exactLines = [
    { quotation_line_id: 'quote-service' },
    { quotation_line_id: 'quote-material' },
  ];

  assert.equal(hasExactQuotationLineSet(quotationLines, exactLines), true, 'the original service and material rows are preserved');
  assert.equal(hasExactQuotationLineSet(quotationLines, exactLines.slice(0, 1)), false, 'omitting a quote row is rejected');
  assert.equal(hasExactQuotationLineSet(quotationLines, [
    { quotation_line_id: 'quote-service' },
    { quotation_line_id: 'quote-service' },
  ]), false, 'duplicating one source row to replace another is rejected');
  assert.equal(hasExactQuotationLineSet(quotationLines, [
    { quotation_line_id: 'quote-service' },
    { quotation_line_id: null },
  ]), false, 'a manually entered row without a source ID is rejected');
  assert.equal(hasExactQuotationLineSet(quotationLines, [
    { quotation_line_id: 'quote-service' },
    { quotation_line_id: 'unrelated-line' },
  ]), false, 'an unrelated source ID is rejected');
  assert.equal(hasExactQuotationLineSet([{ id: 'duplicate' }, { id: 'duplicate' }], [
    { quotation_line_id: 'duplicate' },
    { quotation_line_id: 'duplicate' },
  ]), false, 'a malformed quotation with duplicate line IDs is not treated as a complete set');

  assert.match(SalesContractDraftCreate.body.source, /const hasExactQuotationLineSet = function hasExactQuotationLineSet/);
  assert.match(SalesContractDraftCreate.body.source, /if \(quoteId && !hasExactQuotationLineSet\(quoteLines, lines\)\)/);
});
