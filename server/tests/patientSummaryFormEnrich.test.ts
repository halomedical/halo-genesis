import assert from 'assert';
import {
  appendFormDataToMarkdown,
  formDataLinesFromRecord,
} from '../utils/patientSummaryFormEnrich';

function run() {
  const lines = formDataLinesFromRecord(
    { field_a: 'Value 1' },
    [{ id: 'field_a', title: 'Allergy', type: 'string' }]
  );
  assert.deepStrictEqual(lines, ['- **Allergy**: Value 1']);

  const out = appendFormDataToMarkdown(
    '# Patient Summary\n',
    { field_a: 'Value 1' },
    [{ id: 'field_a', title: 'Allergy', type: 'string' }],
    { templateName: 'Admission form', savedAt: '2026-06-12T10:00:00.000Z' }
  );
  assert(out.includes('## New Form Data Added'));
  assert(out.includes('### Admission form — 2026-06-12'));
  assert(out.includes('- **Allergy**: Value 1'));

  console.log('patientSummaryFormEnrich.test.ts: ok');
}

run();
