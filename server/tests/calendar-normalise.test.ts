import assert from 'assert';
import { __test__normaliseGoogleEvent } from '../services/calendar';

const sampleEvent = {
  id: 'evt-1',
  summary: 'Sarah Connor',
  description: 'Follow-up visit',
  location: 'Room 3B',
  status: 'confirmed',
  start: { dateTime: '2026-02-25T10:00:00.000Z' },
  end: { dateTime: '2026-02-25T10:30:00.000Z' },
  extendedProperties: {
    private: {
      patientId: 'patient-folder-id',
      haloAttachmentFileIds: 'file-1,file-2',
    },
  },
  attachments: [
    {
      fileId: 'file-1',
      title: 'Prep note',
      fileUrl: 'https://drive.google.com/file/d/file-1/view',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  ],
} as any;

function run() {
  const mapped = __test__normaliseGoogleEvent(sampleEvent);
  assert(mapped, 'Mapped event should not be null');
  assert.strictEqual(mapped!.id, 'evt-1');
  assert.strictEqual(mapped!.patientId, 'patient-folder-id');
  assert.strictEqual(mapped!.attachments?.length, 1);
  assert.strictEqual(mapped!.attachments?.[0].fileId, 'file-1');
  assert(mapped!.extendedProps, 'extendedProps should be present');
  assert.strictEqual(mapped!.extendedProps!.patientId, 'patient-folder-id');
  // Dates should be preserved as ISO strings
  assert.strictEqual(mapped!.start, '2026-02-25T10:00:00.000Z');
  assert.strictEqual(mapped!.end, '2026-02-25T10:30:00.000Z');
}

run();

