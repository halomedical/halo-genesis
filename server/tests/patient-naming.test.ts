import assert from 'assert';
import {
  CUSTOM_PATIENT_NAMING_ID,
  DEFAULT_PATIENT_NAMING,
  PATIENT_NAMING_PRESETS,
  normalizePatientNamingConfig,
  resolvePatientNaming,
} from '../../shared/patientNaming';
import {
  formatPatientDisplayName,
  formatPatientFolderName,
  formatPatientSubtitle,
  parseFolderString,
  splitPatientName,
} from '../../shared/patientNamingEngine';
import { normalizeUserSettings } from '../../shared/types';

const sample = {
  name: 'John Smith',
  dob: '1990-01-15',
  sex: 'M' as const,
  folderNumber: 'A-12',
  idNumber: '9001155009087',
  memberNumber: 'MEM001',
};

function run() {
  // Default folder encoding (behavior-preserving)
  assert.strictEqual(
    formatPatientFolderName(sample, DEFAULT_PATIENT_NAMING),
    'John Smith__1990-01-15__M'
  );
  assert.strictEqual(formatPatientDisplayName(sample, DEFAULT_PATIENT_NAMING), 'John Smith');
  assert.strictEqual(formatPatientSubtitle(sample, DEFAULT_PATIENT_NAMING), '1990-01-15');

  // Last, First preset
  const lastFirst = PATIENT_NAMING_PRESETS.find((p) => p.id === 'last_first_dob')!;
  assert.strictEqual(formatPatientDisplayName(sample, lastFirst), 'Smith, John');
  assert.strictEqual(
    formatPatientFolderName(sample, lastFirst),
    'Smith_John__1990-01-15__M'
  );

  // Folder number prefix with omit
  const folderPrefix = PATIENT_NAMING_PRESETS.find((p) => p.id === 'folder_number_prefix')!;
  assert.strictEqual(
    formatPatientFolderName(sample, folderPrefix),
    'A-12__John Smith__1990-01-15__M'
  );
  assert.strictEqual(formatPatientSubtitle(sample, folderPrefix), 'A-12 · 1990-01-15');
  // Missing folder_number omitted from subtitle
  assert.strictEqual(
    formatPatientSubtitle({ name: 'John Smith', dob: '1990-01-15', sex: 'M' }, folderPrefix),
    '1990-01-15'
  );

  // Name split helpers
  assert.deepStrictEqual(splitPatientName('John Michael Smith', 'last_token_is_surname'), {
    firstName: 'John Michael',
    lastName: 'Smith',
  });
  assert.deepStrictEqual(splitPatientName('Smith John Michael', 'first_token_is_surname'), {
    firstName: 'John Michael',
    lastName: 'Smith',
  });

  // Legacy parse
  const parsed = parseFolderString('John Smith__1990-01-15__M');
  assert(parsed);
  assert.strictEqual(parsed!.pName, 'John Smith');
  assert.strictEqual(parsed!.pDob, '1990-01-15');
  assert.strictEqual(parsed!.pSex, 'M');

  const legacy = parseFolderString('Smith_John__15-01-1990__F');
  assert(legacy);
  assert.strictEqual(legacy!.pName, 'John Smith');
  assert.strictEqual(legacy!.pDob, '1990-01-15');
  assert.strictEqual(legacy!.pSex, 'F');

  // Fallback defaults for missing dob/sex in folder encoding
  assert.strictEqual(
    formatPatientFolderName({ name: 'Ada Lovelace', dob: '', sex: 'F' }, DEFAULT_PATIENT_NAMING),
    'Ada Lovelace__Unknown__F'
  );

  // Settings normalize + resolve
  const settings = normalizeUserSettings({
    firstName: 'Doc',
    lastName: 'Who',
    profession: 'GP',
    department: 'General',
    patientNamingId: 'last_first_dob',
  });
  assert.strictEqual(settings.patientNamingId, 'last_first_dob');
  assert.strictEqual(settings.patientNamingConfig?.displayTemplate, '{last_name}, {first_name}');

  const custom = resolvePatientNaming({
    patientNamingId: CUSTOM_PATIENT_NAMING_ID,
    patientNamingConfig: normalizePatientNamingConfig({
      id: CUSTOM_PATIENT_NAMING_ID,
      label: 'Custom',
      folderTemplate: '{id_number}__{name}',
      displayTemplate: '{name} [{member_number}]',
      subtitleTemplate: '{dob}',
      missingFieldBehavior: 'omit',
    }),
  });
  assert.strictEqual(
    formatPatientFolderName(sample, custom),
    '9001155009087__John Smith'
  );
  assert.strictEqual(formatPatientDisplayName(sample, custom), 'John Smith [MEM001]');

  console.log('patient-naming tests passed');
}

run();
