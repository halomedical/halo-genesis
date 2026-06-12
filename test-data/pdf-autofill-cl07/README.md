# CL07 autofill test patient — Margaret Thandi Ndlovu

Fictional patient data for testing **CL07 Accident or Illness Claim Form (Medical Practitioner)** autofill against Halo `patient-summary.md`.

## Files

| File | Purpose |
|------|---------|
| `Margaret_Ndlovu__1987-03-14__F/patient-summary.md` | Upload to the patient folder root in Google Drive (this is what autofill reads). |
| `import-patient.json` | Optional bulk import payload for Halo **Import patients**. |
| `bootstrap-in-browser.js` | One-shot script while logged into Halo (creates patient + uploads summary). |

## Quick setup (recommended)

1. Log into Halo locally (`npm run dev`) with Google Drive connected.
2. Open the app in the browser, DevTools → Console.
3. Paste and run the contents of `bootstrap-in-browser.js`.
4. Open the new patient workspace → PDF Filler → select **CL07** template → **Autofill**.

## Manual setup

1. **Create patient** in Halo (or POST `import-patient.json` via Settings → import if you use that flow).
   - Folder name will be: `Margaret Thandi Ndlovu__1987-03-14__F`
2. In Google Drive, open that folder under `Halo_Patients`.
3. **Important:** Trash the auto-created `_Summary.md` if it only says “No entries yet” — otherwise the summary engine may rebuild `patient-summary.md` from that stub on first refresh.
4. Upload `patient-summary.md` from this directory to the **patient folder root** (not a subfolder).
5. In PDF Filler, run autofill for template `CL07_Accident_or_Illness_Claim_Form_Medical_Practitioner`.

## Expected autofill hits

The summary includes explicit values for illness dates, hospital stay, Bidvest claim number, Discovery membership, patient demographics, diagnosis narrative, referring GP, and treating doctor contact details — aligned with CL07 schema field titles.

All identifiers, bank details, and policy numbers are **synthetic** for testing only.
