import assert from 'assert';
import {
  findManuallyTypedFields,
  mergeHumanFieldDeltas,
} from '../../shared/patientFormDeltas';

function run() {
  const initial = { name: 'Jane', allergy: '' };
  const finalManual = { name: 'Jane', allergy: 'Penicillin' };
  assert.deepStrictEqual(findManuallyTypedFields(initial, finalManual), {
    allergy: 'Penicillin',
  });

  const autofill = { name: 'Jane Doe', allergy: null };
  const finalCorrected = { name: 'Jane Smith', allergy: 'Penicillin' };
  const merged = mergeHumanFieldDeltas(initial, autofill, finalCorrected);
  assert.strictEqual(merged.name, 'Jane Smith');
  assert.strictEqual(merged.allergy, 'Penicillin');

  const noAutofill = mergeHumanFieldDeltas(initial, null, finalManual);
  assert.deepStrictEqual(noAutofill, { allergy: 'Penicillin' });

  console.log('patientFormDeltas.test.ts: ok');
}

run();
