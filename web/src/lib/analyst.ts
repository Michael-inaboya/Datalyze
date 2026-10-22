import Anthropic from "@anthropic-ai/sdk";
import { breakdown, BREAKDOWN_SCHEMA, summarize, type BreakdownInput } from "./analystData";
import type { Currency, Expense, Sale } from "./types";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export const MAX_QUESTION = 1000;
export const MAX_TURNS = 20;
const MAX_ROUNDS = 6;

const INSTRUCTIONS = `You are the analyst inside Datalyze, a business intelligence app for small businesses. The owner asks you about their own sales, customers, costs and forecast.

The data summary below was computed by Datalyze from their imported data, using the same calculations as their dashboard. Treat it as the source of truth. When you need something finer (a customer's history, a product by month, a date range, costs in a category), call the breakdown tool rather than estimating.

How to answer:
- Lead with the answer in a sentence or two, then the few numbers that back it. Owners read this between other jobs.
- Use the business's currency and round sensibly. Say which dates a figure covers.
- When something calls for action, suggest one or two concrete steps the owner could take this week.
- Be clear about what the data cannot tell you, such as profit when no costs are imported, or why a customer left. Never invent figures, customers or products.
- Churn risk is a 0 to 1 score from how overdue a customer is against their usual gap between purchases, raised when their spending is falling. Forecasts are estimates with a range, not promises.
- Keep it short. Write plain sentences. For a list, start each line with "- ". Use **bold** sparingly. No tables, headings or other markdown.
- If asked about something unrelated to running this business, say briefly that you can only help with their Datalyze data.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "breakdown",
    description:
      "Add up the business's sales or expenses with optional filters, split by a date period, weekday, customer, product or expense category. Use it for any figure the summary does not already give.",
    input_schema: BREAKDOWN_SCHEMA as unknown as Anthropic.Beta.BetaTool.InputSchema,
  },
];

export type AnalystData = { name: string; currency: Currency; sales: Sale[]; expenses: Expense[] };

/** Answers the latest question in `turns`, streaming the reply's text through `onText`. */
export async function askAnalyst(data: AnalystData, turns: ChatTurn[], onText: (text: string) => void, signal?: AbortSignal) {
  const client = new Anthropic();
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS },
    {
      type: "text",
      text: `Data summary (JSON):\n${summarize(data.name, data.currency, data.sales, data.expenses)}`,
      cache_control: { type: "ephemeral" },
    },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.beta.messages.stream(
      {
        model: "claude-opus-5-5",
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        tools: TOOLS,
        messages,
      },
      { signal },
    );
    stream.on("text", (text) => onText(text));
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      onText("\n\nI can't help with that one. Try asking about your sales, customers or costs.");
      return;
    }
    if (message.stop_reason !== "tool_use") return;

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      try {
        if (block.name !== "breakdown") throw new Error(`Unknown tool "${block.name}".`);
        const out = breakdown(data.sales, data.expenses, block.input as BreakdownInput);
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: (e as Error).message, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  onText("\n\nThat needed more lookups than I allow for one question. Try narrowing it down.");
}

/** Checks a chat posted by the browser: alternating turns, ending on a short question. */
export function validTurns(value: unknown): ChatTurn[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_TURNS) return null;
  const turns: ChatTurn[] = [];
  for (const [i, t] of value.entries()) {
    const role = i % 2 === 0 ? "user" : "assistant";
    if (!t || t.role !== role || typeof t.content !== "string" || !t.content.trim()) return null;
    if (t.content.length > (role === "user" ? MAX_QUESTION : 8000)) return null;
    turns.push({ role, content: t.content });
  }
  return turns.at(-1)!.role === "user" ? turns : null;
}
