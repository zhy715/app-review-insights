import type { RawReview } from "./types";
import { extractAppId } from "./sse";

// ============================================================
// App Store RSS Feed Review Collector
// Uses Apple's official RSS feed (free, no auth required)
// Max: 10 pages × 50 reviews = 500 reviews per country
// ============================================================

const RSS_BASE_URL = "https://itunes.apple.com";
const MAX_PAGES = 10;
const DELAY_MS = 2000; // 2s between pages to avoid rate limiting

interface RSSEntry {
  id?: { label?: string };
  "im:name"?: { label?: string };
  "im:rating"?: { label?: string };
  title?: { label?: string };
  content?: { label?: string; type?: string };
  author?: { name?: { label?: string } };
  "im:version"?: { label?: string };
  updated?: { label?: string };
}

interface RSSResponse {
  feed?: {
    entry?: RSSEntry[] | RSSEntry;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a single page of reviews from the RSS feed
 */
async function fetchPage(
  appId: string,
  country: string,
  page: number,
  sort: "mostRecent" | "mostHelpful" = "mostRecent"
): Promise<RawReview[]> {
  const url = `${RSS_BASE_URL}/${country}/rss/customerreviews/page=${page}/id=${appId}/sortby=${sort}/json`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "AppReviewInsights/1.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        "Rate limited by App Store. Please wait a moment and try again."
      );
    }
    throw new Error(
      `Failed to fetch reviews: HTTP ${response.status} ${response.statusText}`
    );
  }

  const data: RSSResponse = await response.json();
  const entries = data.feed?.entry;

  if (!entries) {
    return []; // No more reviews
  }

  // Normalize to array (single entry may be returned as object)
  const entryList = Array.isArray(entries) ? entries : [entries];

  // First entry is app metadata, skip it
  const reviewEntries = entryList.slice(1);

  return reviewEntries.map((entry) => ({
    id: entry.id?.label?.replace(/^urn:uuid:/, "") || `unknown-${Math.random()}`,
    rating: parseInt(entry["im:rating"]?.label || "0", 10),
    title: entry.title?.label || "",
    content: entry.content?.label || "",
    author: entry.author?.name?.label || "Anonymous",
    date: entry.updated?.label || new Date().toISOString(),
    version: entry["im:version"]?.label,
  }));
}

/**
 * Fetch all available reviews for an app (up to 10 pages)
 */
export async function fetchAllReviews(
  appStoreUrl: string,
  country: string = "us",
  onProgress?: (page: number, total: number) => void
): Promise<{ reviews: RawReview[]; appName: string; appId: string }> {
  const appId = extractAppId(appStoreUrl);
  if (!appId) {
    throw new Error(
      `Could not extract App ID from URL: ${appStoreUrl}. Expected format: https://apps.apple.com/.../idXXXXXX`
    );
  }

  const allReviews: RawReview[] = [];
  let appName = "";
  let emptyPagesCount = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const reviews = await fetchPage(appId, country, page, "mostRecent");

      if (reviews.length === 0) {
        emptyPagesCount++;
        if (emptyPagesCount >= 2) break; // 2 empty pages in a row = no more data
        if (page > 1) await delay(DELAY_MS);
        continue;
      }

      emptyPagesCount = 0;
      allReviews.push(...reviews);

      // Extract app name from first page's metadata
      if (page === 1 && appName === "") {
        appName = await fetchAppName(appId, country);
      }

      onProgress?.(page, allReviews.length);

      // Respect rate limits with delay between pages
      if (page < MAX_PAGES) {
        await delay(DELAY_MS);
      }
    } catch (err) {
      if (page === 1) throw err; // If first page fails, propagate error
      console.warn(`Failed to fetch page ${page}: ${err}`);
      break; // If subsequent page fails, stop but keep what we have
    }
  }

  return { reviews: allReviews, appName, appId };
}

/**
 * Fetch the app name from the RSS feed metadata
 */
async function fetchAppName(appId: string, country: string): Promise<string> {
  try {
    const url = `${RSS_BASE_URL}/${country}/rss/customerreviews/page=1/id=${appId}/sortby=mostRecent/json`;
    const response = await fetch(url);
    const data: RSSResponse = await response.json();
    const entries = data.feed?.entry;
    if (entries) {
      const first = Array.isArray(entries) ? entries[0] : entries;
      const name = first?.["im:name"]?.label;
      if (name) return name;
    }
  } catch {
    // Ignore — app name is decorative
  }
  return "Unknown App";
}
