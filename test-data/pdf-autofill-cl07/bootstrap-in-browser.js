/**
 * Run in the browser console while logged into Halo (same origin as the app).
 * Creates Margaret Ndlovu, removes stub _Summary.md, uploads patient-summary.md.
 *
 * Before running: serve patient-summary.md from the dev server or paste MARKDOWN below.
 */
(async () => {
  const PATIENT = {
    name: 'Margaret Thandi Ndlovu',
    dob: '1987-03-14',
    sex: 'F',
    medicalAid: 'Discovery Health',
    medicalAidPlan: 'Classic Comprehensive',
    medicalAidNumber: '4829103756',
    memberNumber: '4829103756',
    dependantCode: '00',
    idNumber: '8703140583087',
    schemeCode: 'DISC',
    planCode: 'CCOMP',
    initials: 'MT',
    statusIndicator: 'A',
    folderNumber: 'CL07-TEST-001',
  };

  const SUMMARY_URL =
    '/test-fixtures/pdf-autofill-cl07/Margaret_Ndlovu__1987-03-14__F/patient-summary.md';

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error(`${path} → ${res.status}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
    return data;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  console.log('[cl07-bootstrap] Creating patient…');
  const patient = await api('/api/drive/patients', {
    method: 'POST',
    body: JSON.stringify(PATIENT),
  });
  const folderId = patient.id;
  console.log('[cl07-bootstrap] Patient folder:', folderId, patient.name);

  console.log('[cl07-bootstrap] Listing files…');
  const list = await api(`/api/drive/patients/${folderId}/files?pageSize=100`);
  const stubSummary = (list.files || []).find((f) => f.name === '_Summary.md');
  if (stubSummary) {
    console.log('[cl07-bootstrap] Removing stub _Summary.md', stubSummary.id);
    await api(`/api/drive/files/${stubSummary.id}`, { method: 'DELETE' });
  }

  let markdown;
  try {
    const mdRes = await fetch(SUMMARY_URL);
    if (!mdRes.ok) throw new Error(String(mdRes.status));
    markdown = await mdRes.text();
  } catch (e) {
    console.warn('[cl07-bootstrap] Could not load summary from dev server — open README and upload patient-summary.md manually.', e);
    return patient;
  }

  const blob = new Blob([markdown], { type: 'text/plain' });
  const file = new File([blob], 'patient-summary.md', { type: 'text/plain' });
  const fileData = await fileToBase64(file);

  console.log('[cl07-bootstrap] Uploading patient-summary.md…');
  await api(`/api/drive/patients/${folderId}/upload`, {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'patient-summary.md',
      fileType: 'text/plain',
      fileData,
      patientId: folderId,
    }),
  });

  console.log('[cl07-bootstrap] Done. Open patient in Halo and autofill CL07.', patient);
  return patient;
})();
