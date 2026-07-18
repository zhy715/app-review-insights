import type { PipelineState } from "./types";

// ============================================================
// SSE (Server-Sent Events) utilities
// ============================================================

/**
 * Create an SSE stream response for a pipeline execution.
 * The `execute` callback receives a `send` function to push PipelineState updates.
 */
export function createSSEResponse(
  signal: AbortSignal,
  execute: (send: (state: Partial<PipelineState>) => void) => Promise<void>
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(state: Partial<PipelineState>) {
        const data = JSON.stringify(state);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      // Heartbeat every 30s to prevent proxy timeouts
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          // stream may already be closed
        }
      }, 30000);

      // Handle client disconnect
      signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // ignore
        }
      });

      try {
        await execute(send);
      } catch (err) {
        send({
          stage: "error",
          message: err instanceof Error ? err.message : "Unknown error occurred",
          errors: [
            {
              stage: "error",
              message: err instanceof Error ? err.message : "Unknown error",
              detail: err instanceof Error ? err.stack : undefined,
              timestamp: new Date().toISOString(),
            },
          ],
        });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering
    },
  });
}

/**
 * Generate a unique ID with prefix (e.g. "F-001", "REQ-001")
 */
export function generateId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

/**
 * Extract App ID from an App Store URL
 */
export function extractAppId(url: string): string | null {
  const match = url.match(/id(\d+)/);
  return match ? match[1] : null;
}

/**
 * Detect if a URL is a valid App Store URL
 */
export function isAppStoreUrl(url: string): boolean {
  return /apps\.apple\.com|itunes\.apple\.com/.test(url);
}
