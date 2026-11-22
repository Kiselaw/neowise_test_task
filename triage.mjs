import { classify } from "./mock-ai.mjs";

/**
 * @typedef {{ status: "ready", topic: "delivery" | "pricing" | "other", draft: string }
 *   | { status: "manual_review", topic: null, draft: null }} TriageResult
 */

/**
 * Validate the AI response and fall back to manual review on any model failure.
 * @param {string} text Validated request text.
 * @returns {Promise<TriageResult>}
 */
export async function triage(text) {
  try {
    const raw = await classify(text, { signal: AbortSignal.timeout(300) });
    const result = /** @type {unknown} */ (JSON.parse(raw));

    if (
      result !== null &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      "topic" in result &&
      (result.topic === "delivery" || result.topic === "pricing" || result.topic === "other") &&
      "draft" in result &&
      typeof result.draft === "string" &&
      result.draft.trim().length > 0
    ) {
      return { status: "ready", topic: result.topic, draft: result.draft.trim() };
    }
  } catch {
    // Timeouts, provider errors and malformed JSON all require manual review.
  }

  return { status: "manual_review", topic: null, draft: null };
}
