"use strict";
// GST math for the store. Business is registered in Rajasthan (state code 08).
// Rule: if customer's place-of-supply state code == business state code -> intra-state -> CGST+SGST (split gstRate/2 each).
// Otherwise -> inter-state -> IGST (full gstRate).
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUSINESS_STATE_CODE = void 0;
exports.round2 = round2;
exports.computeLineTax = computeLineTax;
exports.isInterStateSupply = isInterStateSupply;
exports.BUSINESS_STATE_CODE = process.env.BUSINESS_STATE_CODE || "08";
function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
function computeLineTax(params) {
    const { rate, quantity, gstRate } = params;
    const discountPct = params.discountPct || 0;
    const gross = rate * quantity;
    const discountAmt = round2((gross * discountPct) / 100);
    const taxableValue = round2(gross - discountAmt);
    const isInterState = !!params.customerStateCode && params.customerStateCode !== exports.BUSINESS_STATE_CODE;
    let cgstAmt = 0;
    let sgstAmt = 0;
    let igstAmt = 0;
    if (isInterState) {
        igstAmt = round2((taxableValue * gstRate) / 100);
    }
    else {
        cgstAmt = round2((taxableValue * (gstRate / 2)) / 100);
        sgstAmt = round2((taxableValue * (gstRate / 2)) / 100);
    }
    const lineTotal = round2(taxableValue + cgstAmt + sgstAmt + igstAmt);
    return { taxableValue, cgstAmt, sgstAmt, igstAmt, lineTotal };
}
function isInterStateSupply(customerStateCode) {
    return !!customerStateCode && customerStateCode !== exports.BUSINESS_STATE_CODE;
}
//# sourceMappingURL=gst.js.map