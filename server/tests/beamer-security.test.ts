import assert from 'assert';
import fs from 'fs';
import path from 'path';
import type { BeamerAssetRow } from '../services/beamerStore';

async function main(): Promise<void> {
  process.env.GOOGLE_CLIENT_ID ||= 'test-client';
  process.env.GOOGLE_CLIENT_SECRET ||= 'test-secret';
  process.env.GEMINI_API_KEY ||= 'test-key';
  process.env.SESSION_SECRET ||= 'test-session-secret';
  process.env.NODE_ENV = 'production';
  process.env.CLIENT_URL = 'https://staging.halo.example';
  process.env.PRODUCTION_URL = 'https://app.halo.example';

  const {
    BeamerPayloadError,
    assertAssetContentAccess,
    assertHeartbeatSchemaVersion,
    assertDownloadableRasterMetadata,
    decodeCanonicalBase64,
    isSafeInstallerReleaseUrl,
    resolveBeamerDeviceStatus,
    validateRasterBytes,
  } = await import('../services/beamerValidation');
  const { isTrustedBrowserOrigin, requireTrustedJsonMutation } = await import('../security/trustedOrigins');
  const { BeamerError, BeamerService } = await import('../services/beamer');

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const encoded = png.toString('base64');
  assert.deepStrictEqual(decodeCanonicalBase64(encoded), png);
  validateRasterBytes('image/png', png);
  assert.strictEqual(assertHeartbeatSchemaVersion(3), 3);
  assert.doesNotThrow(() => assertAssetContentAccess('pending_review', 'ready'));
  assert.doesNotThrow(() => assertAssetContentAccess('approved', 'ready'));
  assert.strictEqual(resolveBeamerDeviceStatus({
    lastSeenAt: new Date(1_000).toISOString(), nowMs: 10_000, onlineThresholdMs: 1_000, hasActionableWarning: false,
  }), 'offline');
  assert.strictEqual(resolveBeamerDeviceStatus({
    lastSeenAt: new Date(10_000).toISOString(), nowMs: 10_000, onlineThresholdMs: 1_000, hasActionableWarning: false,
  }), 'online');
  assert.strictEqual(resolveBeamerDeviceStatus({
    lastSeenAt: null, nowMs: 10_000, onlineThresholdMs: 1_000, hasActionableWarning: true,
  }), 'attention');
  assert.strictEqual(isSafeInstallerReleaseUrl('https://downloads.example/beamer.exe'), true);
  assert.strictEqual(isSafeInstallerReleaseUrl('http://localhost:8787/beamer.exe'), true);
  assert.strictEqual(isSafeInstallerReleaseUrl('http://127.0.0.1:8787/beamer.exe'), true);
  assert.strictEqual(isSafeInstallerReleaseUrl('http://[::1]:8787/beamer.exe'), true);
  assert.strictEqual(isSafeInstallerReleaseUrl('http://192.168.1.5/beamer.exe'), false);
  assert.strictEqual(isSafeInstallerReleaseUrl('http://downloads.example/beamer.exe'), false);
  assert.strictEqual(isSafeInstallerReleaseUrl('https://user:pass@downloads.example/beamer.exe'), false);
  assert.doesNotThrow(() => assertDownloadableRasterMetadata('image/jpeg', 1024, 2048));
  assert.throws(() => assertDownloadableRasterMetadata('application/pdf', 1024, 2048), BeamerPayloadError);
  assert.throws(() => assertDownloadableRasterMetadata('image/jpeg', 4096, 2048), BeamerPayloadError);

  assert.strictEqual(isTrustedBrowserOrigin('https://staging.halo.example'), true);
  assert.strictEqual(isTrustedBrowserOrigin('https://app.halo.example'), true);
  assert.strictEqual(isTrustedBrowserOrigin('https://attacker-app.herokuapp.com'), false);
  const runMutationGuard = (contentType: string, origin?: string) => {
    let status = 200;
    let nextCalled = false;
    const req = {
      is: (expected: string) => expected === 'application/json' && contentType === 'application/json',
      get: (name: string) => name === 'origin' ? origin : undefined,
    };
    const res = {
      status(code: number) { status = code; return this; },
      json() { return this; },
    };
    requireTrustedJsonMutation(req as never, res as never, () => { nextCalled = true; });
    return { status, nextCalled };
  };
  assert.deepStrictEqual(runMutationGuard('application/x-www-form-urlencoded', 'https://app.halo.example'), { status: 415, nextCalled: false });
  assert.deepStrictEqual(runMutationGuard('application/json', 'https://attacker-app.herokuapp.com'), { status: 403, nextCalled: false });
  assert.deepStrictEqual(runMutationGuard('application/json'), { status: 403, nextCalled: false });
  assert.deepStrictEqual(runMutationGuard('application/json', 'https://staging.halo.example'), { status: 200, nextCalled: true });

  const makeApprovalResumeHarness = (alreadyMoved: boolean) => {
    let asset: BeamerAssetRow = {
      id: 'asset-1', practice_id: 'practice-1', patient_id: 'patient-1', device_id: 'device-1',
      drive_file_id: 'drive-file-1', client_id: 'client-1', source: 'windows' as const,
      mime_type: 'image/jpeg', byte_size: 100, review_status: 'pending_review' as const,
      processing_status: 'processing', captured_at: new Date(0).toISOString(),
      review_reason_code: null, reviewed_by_email: 'reviewer@example.test',
      reviewed_at: new Date(1).toISOString(), created_at: new Date(0).toISOString(),
    };
    let moves = 0;
    let rollbacks = 0;
    const store = {
      configured: true,
      getAsset: async () => ({ ...asset }),
      getPracticeConfig: async () => ({
        practice_id: 'practice-1', google_subject_email: 'practice@example.test', patient_root_id: 'patients',
        shared_drive_id: 'drive-1', shared_drive_name: 'Practice', review_folder_id: 'review',
        provisioning_status: 'ready' as const, provisioning_error: null,
      }),
      hasVerifiedPatient: async () => true,
      completeApproval: async (_practiceId: string, _assetId: string, token: string) => {
        if (asset.review_status !== 'pending_review' || asset.processing_status !== 'processing' || asset.reviewed_at !== token) return null;
        asset = { ...asset, review_status: 'approved' as const, processing_status: 'ready' as const };
        return { ...asset };
      },
      rollbackApproval: async () => { rollbacks += 1; return null; },
      beginApproval: async () => { throw new Error('a durable claim must be resumed, not replaced'); },
    };
    const drive = {
      configured: true,
      moveReviewAsset: async () => { moves += 1; return !alreadyMoved; },
    };
    return {
      service: new BeamerService(store as never, drive as never, () => new Date(2)),
      state: () => ({ asset, moves, rollbacks }),
    };
  };
  for (const alreadyMoved of [false, true]) {
    const harness = makeApprovalResumeHarness(alreadyMoved);
    const result = await harness.service.review('practice-1', 'asset-1', { action: 'approve', patientId: 'patient-1' }, 'reviewer@example.test');
    assert.strictEqual(result.upload.status, 'approved');
    assert.strictEqual(harness.state().asset.review_status, 'approved');
    assert.strictEqual(harness.state().rollbacks, 0);
  }
  const concurrentHarness = makeApprovalResumeHarness(false);
  const concurrent = await Promise.all([
    concurrentHarness.service.review('practice-1', 'asset-1', { action: 'approve', patientId: 'patient-1' }, 'reviewer@example.test'),
    concurrentHarness.service.review('practice-1', 'asset-1', { action: 'approve', patientId: 'patient-1' }, 'reviewer@example.test'),
  ]);
  assert.deepStrictEqual(concurrent.map((item) => item.upload.status), ['approved', 'approved']);
  assert.strictEqual(concurrentHarness.state().rollbacks, 0);
  const conflictingHarness = makeApprovalResumeHarness(false);
  await assert.rejects(
    () => conflictingHarness.service.review('practice-1', 'asset-1', { action: 'approve', patientId: 'patient-2' }, 'reviewer@example.test'),
    (error: unknown) => error instanceof BeamerError && error.status === 409
  );
  await assert.rejects(
    () => conflictingHarness.service.review('practice-1', 'asset-1', { action: 'reject' }, 'reviewer@example.test'),
    (error: unknown) => error instanceof BeamerError && error.status === 409
  );

  assert.throws(() => decodeCanonicalBase64(`${encoded}\n`), (error: unknown) =>
    error instanceof BeamerPayloadError && error.status === 400
  );
  assert.throws(() => validateRasterBytes('image/jpeg', png), (error: unknown) =>
    error instanceof BeamerPayloadError && error.status === 415
  );
  assert.throws(() => validateRasterBytes('image/heic', Buffer.from('not-an-image')), (error: unknown) =>
    error instanceof BeamerPayloadError && error.status === 415
  );
  assert.throws(() => assertHeartbeatSchemaVersion(2), (error: unknown) =>
    error instanceof BeamerPayloadError && error.status === 409
  );
  assert.throws(() => assertAssetContentAccess('rejected', 'ready'), (error: unknown) =>
    error instanceof BeamerPayloadError && error.status === 404
  );
  assert.throws(() => assertAssetContentAccess('pending_review', 'processing'), (error: unknown) =>
    error instanceof BeamerPayloadError && error.status === 404
  );

  const migration = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase', 'migrations', '20260731165917_beamer_backend.sql'),
    'utf8'
  );
  assert.match(
    migration,
    /create unique index if not exists beamer_devices_installation_idx\s+on public\.beamer_devices \(practice_id, installation_id\)\s+where revoked_at is null;/i,
    'installation IDs must only be unique among active devices so a replacement can reuse a prior installation ID'
  );
  assert.match(
    migration,
    /create unique index if not exists beamer_enrollment_tokens_one_live_per_practice_idx[\s\S]*?where used_at is null and revoked_at is null;/i,
    'each practice must have at most one live enrollment token'
  );
  assert.match(
    migration,
    /add column if not exists access_role text not null default 'member'[\s\S]*?access_role in \('owner', 'admin', 'member'\)/i,
    'practice authority must use a dedicated constrained access_role'
  );

  const entitlementsSource = fs.readFileSync(
    path.resolve(process.cwd(), 'server', 'services', 'practiceEntitlements.ts'),
    'utf8'
  );
  assert.match(entitlementsSource, /access_role:\s*'owner'/, 'a newly created practice must retain its sole creator as owner');
  const onboardingUpdate = entitlementsSource.match(
    /\.from\('practice_users'\)\s*\.update\(\{([\s\S]*?)\}\)\s*\.eq\('email', email\)/
  );
  assert.ok(onboardingUpdate?.[1]);
  assert.doesNotMatch(
    onboardingUpdate![1],
    /access_role/,
    'clinical onboarding must never write practice access authority'
  );

  const beamerStoreSource = fs.readFileSync(
    path.resolve(process.cwd(), 'server', 'services', 'beamerStore.ts'),
    'utf8'
  );
  assert.match(
    beamerStoreSource,
    /from\('practice_features'\)\.select\('beamer'\)[\s\S]*?entitlement\.data\?\.beamer !== true\) return null;/,
    'device authentication must fail closed when Beamer entitlement is disabled'
  );
  const rejectCas = beamerStoreSource.match(/async updateReview[\s\S]*?async beginApproval/)?.[0] || '';
  assert.match(rejectCas, /eq\('review_status', 'pending_review'\)\.eq\('processing_status', 'ready'\)/,
    'rejection must not win after approval has claimed the asset for processing');

  const beamerServiceSource = fs.readFileSync(
    path.resolve(process.cwd(), 'server', 'services', 'beamer.ts'),
    'utf8'
  );
  assert.match(beamerServiceSource, /downloadUrl:\s*null,[\s\S]*?bootstrapUrl:\s*'\/api\/beamer\/windows-installer\/bootstrap'/);
  assert.match(
    beamerServiceSource,
    /if \(input\.patientId\)[\s\S]*?Windows uploads require patient assignment in Beamer Review/,
    'safe v1 must reject Windows-supplied patient assignment'
  );
  assert.match(
    beamerServiceSource,
    /const reviewStatus = 'pending_review' as const;/,
    'every Windows upload must enter pending Review'
  );
  assert.ok(
    beamerServiceSource.indexOf('this.store.beginApproval') < beamerServiceSource.indexOf("this.drive.moveReviewAsset(drive, claimed.drive_file_id, 'approved')"),
    'approval must atomically claim the pending database row before moving its Drive object'
  );
  assert.match(
    beamerServiceSource,
    /ownsPendingClaim && movedByThisRequest[\s\S]*?moveReviewAsset\(drive, claimed\.drive_file_id, 'review'\)/,
    'only the request that moved a still-pending claimed asset may move it back to Review'
  );
  assert.match(
    beamerServiceSource,
    /current\.processing_status === 'processing' && current\.patient_id !== assignedPatientId[\s\S]*?current\.reviewed_at[\s\S]*?latest\.reviewed_at/,
    'same-patient retries must resume a durable approval claim while cross-patient retries remain blocked'
  );
  assert.match(
    beamerServiceSource,
    /const ownsPendingClaim = ownsClaim &&/,
    'a retry that merely resumes another request claim must never roll that claim back'
  );

  const beamerPageSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src', 'shell', 'src', 'features', 'beamer', 'BeamerPage.tsx'),
    'utf8'
  );
  assert.match(
    beamerPageSource,
    /\{\(!device \|\| enrollment\) && \(/,
    'replacement enrollment credentials must remain visible while the old device is still displayed'
  );
  assert.match(beamerPageSource, /createMobileClientId\(\)[\s\S]*?next\.push\(\{ file, clientId: createMobileClientId\(\) \}\)/);
  assert.doesNotMatch(beamerPageSource, /clientId:\s*`mobile-\$\{Date\.now\(\)/);
  assert.match(beamerPageSource, /Changing patient will clear the images currently selected/);
  const previewComponent = beamerPageSource.match(/function ReviewPreview[\s\S]*?function createMobileClientId/)?.[0] || '';
  const previewEffect = previewComponent.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[assetId\]\);/)?.[0] || '';
  assert.doesNotMatch(previewEffect, /fetchBeamerAssetContent/,
    'review previews must only download after explicit user action');
  assert.match(previewComponent, /aria-label=\{failed \? 'Retry preview' : 'Load preview'\}/);

  const apiSource = fs.readFileSync(path.resolve(process.cwd(), 'src', 'shell', 'src', 'services', 'api.ts'), 'utf8');
  const mobileApi = apiSource.match(/export const uploadBeamerMobileFiles[\s\S]*?^};/m)?.[0] || '';
  assert.match(mobileApi, /files\.map\(async \(\{ clientId, file \}\)/);
  assert.doesNotMatch(mobileApi, /Date\.now/);

  const routesSource = fs.readFileSync(path.resolve(process.cwd(), 'server', 'routes', 'beamer.ts'), 'utf8');
  const contentRoute = routesSource.match(/router\.get\('\/assets\/:assetId\/content'[\s\S]*?^\}\);/m)?.[0] || '';
  assert.match(contentRoute, /Cross-Origin-Resource-Policy', 'same-origin'/);

  console.log('Beamer security tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
