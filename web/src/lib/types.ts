export type Sale = {
  /** UTC midnight, in ms */
  date: number;
  /** Empty string for walk-in or guest sales */
  customer: string;
  amount: number;
  product: string | null;
  quantity: number;
  order: string | null;
};

export type Expense = {
  date: number;
  category: string;
  amount: number;
};

export type Kind = "sales" | "expenses";

export const CURRENCIES = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "CA$",
  AUD: "A$",
} as const;

export type Currency = keyof typeof CURRENCIES;
