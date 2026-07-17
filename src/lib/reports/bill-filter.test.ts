import { describe, it, expect } from "vitest";
import { isExcludedBill } from "@/lib/reports/bill-filter";

describe("isExcludedBill", () => {
  it("keeps ordinary supplier bills and expenses", () => {
    expect(isExcludedBill("TD SYNNEX", "Cost of Goods Sold", null)).toBe(false);
    expect(isExcludedBill("Acme Office Supply", "Office Expenses", "Paper")).toBe(false);
    expect(isExcludedBill("AWS", "Software Subscriptions", null)).toBe(false);
    expect(isExcludedBill(null, null, null)).toBe(false);
  });

  it("excludes payroll and wages", () => {
    expect(isExcludedBill("Gusto", "Payroll", null)).toBe(true);
    expect(isExcludedBill(null, "Wages", null)).toBe(true);
    expect(isExcludedBill(null, "Salaries", null)).toBe(true);
    expect(isExcludedBill("ADP", null, "Bi-weekly payroll")).toBe(true);
  });

  it("excludes taxes", () => {
    expect(isExcludedBill("CRA", "Sales Tax Payable", null)).toBe(true);
    expect(isExcludedBill(null, "GST/HST", null)).toBe(true);
    expect(isExcludedBill("IRS", null, null)).toBe(true);
    expect(isExcludedBill(null, "Income Tax", null)).toBe(true);
  });

  it("excludes loans and interest", () => {
    expect(isExcludedBill("Bank of Whatever", "Loan Payment", null)).toBe(true);
    expect(isExcludedBill(null, "Mortgage", null)).toBe(true);
    expect(isExcludedBill(null, "Interest Expense", null)).toBe(true);
  });

  it("excludes credit cards and credit lines", () => {
    expect(isExcludedBill(null, "Credit Card", null)).toBe(true);
    expect(isExcludedBill("Visa", null, null)).toBe(true);
    expect(isExcludedBill("Amex", null, null)).toBe(true);
    expect(isExcludedBill(null, "Line of Credit", null)).toBe(true);
    expect(isExcludedBill(null, "Credit Line", null)).toBe(true);
    expect(isExcludedBill("American Express", null, null)).toBe(true);
  });

  it("does not over-match innocent words", () => {
    // "taxi" should not trip the \btax\b rule.
    expect(isExcludedBill("City Taxi Co", "Travel", null)).toBe(false);
    expect(isExcludedBill("Interstate Batteries", "Supplies", null)).toBe(false);
  });
});
