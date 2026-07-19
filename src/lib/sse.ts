// ============================================================
// Pipeline utility helpers
// (Previously also hosted a createSSEResponse helper, but the app now uses
// an async-job + polling model — see src/app/api/analyze/route.ts. The SSE
// stream helper was dead code and has been removed to keep the surface
// honest with the README.)
// ============================================================

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

