export interface ClaimDiagnosisOption {
  code: string;
  description: string;
}

export interface ClaimLineItemOption {
  procedureCode: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  /** NAPPI product code (MED/@nappi_cd) when procedure uses tariff 0201. */
  nappiCode?: string;
  /** MED/@qty; defaults to line quantity when omitted. */
  medicineQuantity?: number;
}

// Common ICD-10 codes used in MediKredit accreditation / integration pack samples.
export const MEDIKREDIT_DIAGNOSIS_OPTIONS: ClaimDiagnosisOption[] = [
  { code: 'J45.1', description: 'Asthma' },
  { code: 'F32.9', description: 'Depressive episode, unspecified' },
  { code: 'F00.9', description: 'Dementia, unspecified' },
  { code: 'I10', description: 'Essential hypertension' },
  { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications' },
  { code: 'J06.9', description: 'Acute upper respiratory infection, unspecified' },
];

/**
 * Line item presets for billing demos and MediKredit test flows.
 * GP 0911 tariffs from Postman accreditation; NAPPI from Doctor Integration Pack;
 * multi-line physio codes from item-level partial-acceptance sample XML.
 */
export const MEDIKREDIT_LINE_ITEM_OPTIONS: ClaimLineItemOption[] = [
  {
    procedureCode: '0911',
    description: 'Consultation',
    quantity: 1,
    unitPriceCents: 69460,
    totalPriceCents: 69460,
  },
  {
    procedureCode: '0911',
    description: 'Consultation (amended)',
    quantity: 1,
    unitPriceCents: 65000,
    totalPriceCents: 65000,
  },
  {
    procedureCode: '0911',
    description: 'Follow-up consultation',
    quantity: 1,
    unitPriceCents: 50000,
    totalPriceCents: 50000,
  },
  {
    procedureCode: '0911',
    description: 'Consultation ×2 (same day)',
    quantity: 2,
    unitPriceCents: 69460,
    totalPriceCents: 138920,
  },
  {
    procedureCode: '0201',
    description: 'Bandage soffban 150cm × 3m (NAPPI)',
    quantity: 1,
    unitPriceCents: 3600,
    totalPriceCents: 3600,
    nappiCode: '472409018',
    medicineQuantity: 1,
  },
  {
    procedureCode: '0201',
    description: 'Medicine line (NAPPI placeholder)',
    quantity: 1,
    unitPriceCents: 5000,
    totalPriceCents: 5000,
    nappiCode: '700000001',
    medicineQuantity: 1,
  },
  {
    procedureCode: '72501',
    description: 'PM rehabilitation 30 min',
    quantity: 1,
    unitPriceCents: 26240,
    totalPriceCents: 26240,
  },
  {
    procedureCode: '72303',
    description: 'PM myofascial release / soft tissue',
    quantity: 1,
    unitPriceCents: 21090,
    totalPriceCents: 21090,
  },
  {
    procedureCode: '72401aa',
    description: 'PM spinal (partial-reject demo)',
    quantity: 1,
    unitPriceCents: 18400,
    totalPriceCents: 18400,
  },
  {
    procedureCode: '72310',
    description: 'PM neural tissue mobilisation',
    quantity: 1,
    unitPriceCents: 21020,
    totalPriceCents: 21020,
  },
];
