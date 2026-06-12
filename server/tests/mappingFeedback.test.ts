import assert from 'node:assert/strict';
import {
  buildPredictionJsonFromExtractSchema,
  buildValidatedFieldsFromSchemas,
} from '../../shared/mappingFeedback';

const baseline = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      title: 'Name',
      'x-page': 1,
      x: 10,
      y: 20,
      width: 100,
      height: 14,
    },
    dob: {
      type: 'string',
      title: 'DOB',
      'x-page': 1,
      x: 10,
      y: 50,
      width: 80,
      height: 14,
    },
  },
};

const validated = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      title: 'Name',
      'x-page': 1,
      x: 10,
      y: 20,
      width: 100,
      height: 14,
    },
    dob: {
      type: 'string',
      title: 'DOB',
      'x-page': 1,
      x: 12,
      y: 48,
      width: 80,
      height: 14,
    },
    phone: {
      type: 'string',
      title: 'Phone',
      'x-page': 1,
      x: 10,
      y: 80,
      width: 90,
      height: 14,
    },
  },
};

const prediction = buildPredictionJsonFromExtractSchema(baseline, {
  sourceFilename: 'form.pdf',
  extractionMethod: 'gemini-v1',
});
assert.equal(prediction.source, 'halo-genesis-extract-schema');
assert.ok(
  Array.isArray((prediction.mapped_fields as { fields: unknown[] }).fields) &&
    (prediction.mapped_fields as { fields: unknown[] }).fields.length === 2
);

const fields = buildValidatedFieldsFromSchemas(baseline, validated);
assert.equal(fields.find((f) => f.field_id === 'name')?.action, 'unchanged');
assert.equal(fields.find((f) => f.field_id === 'dob')?.action, 'move');
assert.equal(fields.find((f) => f.field_id === 'phone')?.action, 'add');

console.log('mappingFeedback.test.ts: ok');
