import OpenAI from "openai";
import type { LLMConfig } from "./types";

// ============================================================
// DeepSeek Client Wrapper (via OpenAI SDK)
// ============================================================

function getConfig(): LLMConfig {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  };
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const config = getConfig();
    _client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      maxRetries: 0, // We handle retries ourselves
    });
  }
  return _client;
}

// ============================================================
// Retry with exponential backoff + jitter
// ============================================================
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 2000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const error = err as { status?: number; headers?: Record<string, string> };
      const status = error.status;
      const isRetryable =
        status === 429 || (status !== undefined && status >= 500);

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      // Respect Retry-After header if present
      const retryAfter = error.headers?.["retry-after"];
      const delay = retryAfter
        ? parseInt(retryAfter) * 1000
        : baseDelayMs * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5);

      console.warn(
        `[LLM] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms (status: ${status})`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}

// ============================================================
// Core LLM call — sends prompt, returns parsed JSON
// ============================================================
export interface LLMCallOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export async function llmCall<T>(
  options: LLMCallOptions
): Promise<T> {
  const client = getClient();
  const config = getConfig();

  const { systemPrompt, userPrompt, temperature = 0.2, maxTokens = 4096 } =
    options;

  const response = await withRetry(() =>
    client.chat.completions.create({
      model: config.model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    })
  );

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error("LLM returned empty response");
  }

  try {
    return JSON.parse(rawContent) as T;
  } catch {
    // Attempt recovery: strip markdown code fences
    const cleaned = rawContent
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
    throw new Error(`Failed to parse LLM JSON response: ${rawContent.slice(0, 200)}...`);
  }
}

// ============================================================
// Validate LLM response with Zod schema, retry on failure
// ============================================================
import { z } from "zod";

export async function llmCallWithSchema<T>(
  options: LLMCallOptions,
  schema: z.ZodSchema<T>,
  maxAttempts = 2
): Promise<T> {
  let lastError: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rawResult = await llmCall<unknown>({
      ...options,
      // On retry, include the validation error
      userPrompt:
        attempt === 0
          ? options.userPrompt
          : `${options.userPrompt}\n\n[IMPORTANT: Previous response failed validation: ${lastError}. Please ensure your response strictly matches the expected JSON schema.]`,
    });

    const parsed = schema.safeParse(rawResult);
    if (parsed.success) {
      return parsed.data;
    }

    lastError = parsed.error.message;
    console.warn(
      `[LLM] Schema validation failed (attempt ${attempt + 1}/${maxAttempts}): ${lastError}`
    );
  }

  throw new Error(
    `LLM response failed schema validation after ${maxAttempts} attempts: ${lastError}`
  );
}
