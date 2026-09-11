// GST math for the store. Business is registered in Rajasthan (state code 08).
// Rule: if customer's place-of-supply state code == business state code -> intra-state -> CGST+SGST (split gstRate/2 each).
// Otherwise -> inter-state -> IGST (full gstRate).

export const BUSINESS_STATE_CODE = process.env.BUSINESS_STATE_CODE || "08";

export interface LineTax {
  taxableValue: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  lineTotal: number;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeLineTax(params: {
  rate: number; // ex-GST rate per unit
  quantity: number;
  discountPct?: number;
  gstRate: number;
  customerStateCode?: string | null;
}): LineTax {
  const { rate, quantity, gstRate } = params;
  const discountPct = params.discountPct || 0;
  const gross = rate * quantity;
  const discountAmt = round2((gross * discountPct) / 100);
  const taxableValue = round2(gross - discountAmt);

  const isInterState =
    !!params.customerStateCode && params.customerStateCode !== BUSINESS_STATE_CODE;

  let cgstAmt = 0;
  let sgstAmt = 0;
  let igstAmt = 0;

  if (isInterState) {
    igstAmt = round2((taxableValue * gstRate) / 100);
  } else {
    cgstAmt = round2((taxableValue * (gstRate / 2)) / 100);
    sgstAmt = round2((taxableValue * (gstRate / 2)) / 100);
  }

  const lineTotal = round2(taxableValue + cgstAmt + sgstAmt + igstAmt);

  return { taxableValue, cgstAmt, sgstAmt, igstAmt, lineTotal };
}

export function isInterStateSupply(customerStateCode?: string | null): boolean {
  return !!customerStateCode && customerStateCode !== BUSINESS_STATE_CODE;
}
