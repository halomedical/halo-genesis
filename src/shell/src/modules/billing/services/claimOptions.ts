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
}

// Sourced from MediKredit Postman collection claim payload examples.
export const MEDIKREDIT_DIAGNOSIS_OPTIONS: ClaimDiagnosisOption[] = [
  { code: 'J45.1', description: 'Asthma' },
];

// Sourced from MediKredit Postman collection claim payload examples.
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
];
