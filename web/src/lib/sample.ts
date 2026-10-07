import type { Expense, Sale } from "./types";
import { DAY } from "./analytics";

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SAMPLE_NAME = "Ember & Bean Coffee Roasters";

/** Two years of generated sales and costs for a small coffee roaster selling online, in-store and wholesale. */
export function sampleBusiness(end = Date.UTC(2026, 8, 30)): { sales: Sale[]; expenses: Expense[] } {
  const r = rng(7), start = end - 729 * DAY, span = end - start;
  const first = ["Olivia", "James", "Amelia", "Noah", "Priya", "Liam", "Sofia", "Ethan", "Grace", "Marcus", "Chloe", "Daniel", "Aisha", "Oliver", "Emma", "Lucas", "Hannah", "Mateo", "Zara", "Ben", "Isla", "Jamal", "Ruby", "Tom", "Mia", "Kofi", "Ella", "Sam", "Nadia", "Leo"];
  const last = ["Smith", "Johnson", "Patel", "Williams", "Brown", "Garcia", "Taylor", "Jones", "Martin", "Okafor", "Walker", "Hughes", "Nguyen", "Evans", "Clarke", "Lopez", "Wright", "Khan", "Murphy", "Bennett"];
  const products: [string, number][] = [["House Blend 1kg", 24], ["Single Origin 250g", 12], ["Espresso Roast 1kg", 26], ["Decaf 500g", 14], ["Cold Brew Pack", 18], ["Pour-over Kit", 45], ["Gift Box", 38]];
  const wholesaleNames = ["Lagoon Café", "The Reading Room", "Bluebird Bakery", "Corner Office Co-work", "Harbour Hotel", "Harbor Street Diner", "Green Fork Deli", "Studio 9 Gym"];
  const sales: Sale[] = [];
  const names = new Set<string>();
  let orderNo = 1000;
  for (let i = 0; i < 260; i++) {
    const wholesale = i < wholesaleNames.length;
    let name = wholesale ? wholesaleNames[i] : `${first[Math.floor(r() * first.length)]} ${last[Math.floor(r() * last.length)]}`;
    if (names.has(name)) {
      let n = 2;
      while (names.has(`${name} (${n})`)) n++;
      name = `${name} (${n})`;
    }
    names.add(name);
    const join = wholesale ? start + r() * span * 0.5 : start + Math.pow(r(), 0.8) * span * 0.95;
    const interval = wholesale ? 7 + r() * 7 : 12 + r() * 50;
    const basket = wholesale ? 5 + r() * 6 : 0.6 + r() * 1.6;
    const oneTime = !wholesale && r() < 0.22;
    let churn = oneTime ? Infinity : r() < (wholesale ? 0.25 : 0.3) ? join + (0.2 + r() * 0.9) * (end - join) : Infinity;
    const fav = Math.floor(r() * products.length);
    let t = join + r() * interval * DAY;
    if (oneTime) churn = t + DAY;
    while (t < end && t < churn) {
      const d = new Date(t), mo = d.getUTCMonth();
      const season = mo === 11 ? 1.4 : mo === 10 ? 1.15 : mo === 0 ? 0.85 : mo === 6 || mo === 7 ? 0.92 : 1;
      const growth = 1 + (0.35 * (t - start)) / span;
      // customers who are about to churn buy less in their last months
      const fade = churn !== Infinity && churn - t < 75 * DAY ? 0.6 : 1;
      const lines = 1 + (r() < 0.35 ? 1 : 0) + (wholesale && r() < 0.5 ? 1 : 0);
      const order = `#${++orderNo}`;
      for (let k = 0; k < lines; k++) {
        const p = k === 0 && r() < 0.6 ? products[fav] : products[Math.floor(r() * (mo === 11 ? products.length : products.length - 1))];
        const qty = Math.max(1, Math.round(basket * (0.6 + r() * 0.8) * fade * (wholesale ? 1 : season)));
        sales.push({
          date: Date.UTC(d.getUTCFullYear(), mo, d.getUTCDate()),
          customer: name,
          product: p[0],
          quantity: qty,
          amount: Math.round(qty * p[1] * (wholesale ? 0.8 : 1) * growth * 100) / 100,
          order,
        });
      }
      t += (interval * DAY * (0.55 + r() * 0.9)) / (mo === 11 ? 1.3 : 1);
    }
  }
  sales.sort((a, b) => a.date - b.date);
  const byMonth: Record<string, number> = {};
  for (const s of sales) {
    const k = new Date(s.date).toISOString().slice(0, 7);
    byMonth[k] = (byMonth[k] || 0) + s.amount;
  }
  const expenses: Expense[] = [];
  Object.keys(byMonth).sort().forEach((k, i) => {
    const [y, m] = k.split("-").map(Number), rev = byMonth[k];
    const add = (day: number, category: string, amount: number) => expenses.push({ date: Date.UTC(y, m - 1, day), category, amount: Math.round(amount) });
    add(1, "Rent", 1500 + (i >= 12 ? 150 : 0));
    add(28, "Wages", 2600 + i * 45);
    add(10, "Green coffee beans", rev * (0.3 + r() * 0.06) * (i >= 18 ? 1.12 : 1));
    add(12, "Packaging", rev * 0.06);
    add(15, "Marketing", 350 + r() * 600 + (m === 12 ? 800 : 0));
    add(20, "Utilities", 380 + r() * 140);
  });
  return { sales, expenses };
}
