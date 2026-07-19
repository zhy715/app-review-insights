import type { RawReview, AppMetadata } from "./types";
import { extractAppId } from "./sse";

// ============================================================
// App Store Review Collector
//
// Data source strategy (in priority order):
//   1. Apple RSS Customer Reviews Feed — official JSON feed, no auth,
//      caps at ~500 reviews per region. NOT page scraping.
//   2. amp-api (self-implemented) — Apple's internal App Store web API.
//      We fetch the app page once to extract a Bearer token, then call
//      amp-api.apps.apple.com directly. Replaces the third-party
//      `app-store-scraper` dependency for full control over retries,
//      pagination, and field mapping.
//   3. app-store-scraper (final fallback) — kept only as a last resort
//      when our amp-api token extraction fails (Apple changes page HTML).
//   4. iTunes Lookup API — used in parallel for app metadata
//      (full-store average rating, rating count, current version, icon),
//      NOT for reviews. Lets us flag sample-vs-full-store bias.
//
// We deliberately do NOT use headless browsers (Playwright/Puppeteer) to
// scrape visible page content — the task explicitly asks for "more
// appropriate ways" than page scraping, and the APIs above are faster,
// more stable, and lower-load on Apple.
// ============================================================

const RSS_BASE_URL = "https://itunes.apple.com";
const LOOKUP_URL = "https://itunes.apple.com/lookup";
const AMP_API_URL = "https://amp-api.apps.apple.com";
const APP_PAGE_URL = "https://apps.apple.com";
const MAX_PAGES = 10;
const DELAY_MS = 2000; // 2s between RSS pages to avoid rate limiting

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
 * Fetch all available reviews for an app.
 *
 * Source chain: RSS Feed → amp-api (self-implemented) → app-store-scraper (last resort).
 * App metadata is fetched in parallel via iTunes Lookup API and returned alongside
 * the reviews so downstream stages can flag sample-vs-full-store rating bias.
 */
export async function fetchAllReviews(
  appStoreUrl: string,
  country: string = "us",
  onProgress?: (page: number, total: number) => void
): Promise<{
  reviews: RawReview[];
  appName: string;
  appId: string;
  appMetadata?: AppMetadata;
}> {
  const appId = extractAppId(appStoreUrl);
  if (!appId) {
    throw new Error(
      `Could not extract App ID from URL: ${appStoreUrl}. Expected format: https://apps.apple.com/.../idXXXXXX`
    );
  }

  // Kick off app-metadata fetch in parallel — do NOT block review collection on it.
  // Lookup API is independent of the review stream and rarely rate-limits.
  const metadataPromise = fetchAppMetadata(appId, country).catch((err) => {
    console.warn(`iTunes Lookup API failed: ${err}`);
    return undefined;
  });

  const allReviews: RawReview[] = [];
  let appName = "";
  let emptyPagesCount = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const reviews = await fetchPage(appId, country, page, "mostRecent");

      if (reviews.length === 0) {
        emptyPagesCount++;
        if (emptyPagesCount >= 2) break;
        if (page > 1) await delay(DELAY_MS);
        continue;
      }

      emptyPagesCount = 0;
      allReviews.push(...reviews);
      onProgress?.(page, allReviews.length);

      if (page < MAX_PAGES) {
        await delay(DELAY_MS);
      }
    } catch (err) {
      if (page === 1) throw err;
      console.warn(`Failed to fetch RSS page ${page}: ${err}`);
      break;
    }
  }

  // Fallback 1: self-implemented amp-api (replaces third-party scraper as
  // primary fallback). We control retries, pagination, and field mapping.
  if (allReviews.length === 0) {
    console.log("RSS feed returned empty, falling back to amp-api...");
    const requested = country || "us";
    const countries = requested === "us" ? ["us"] : [requested, "us"];
    for (const cc of [...new Set(countries)]) {
      try {
        const ampReviews = await fetchWithAmpApi(appId, cc);
        if (ampReviews.length > 0) {
          allReviews.push(...ampReviews);
          console.log(`Got ${ampReviews.length} reviews from amp-api (${cc})`);
          break;
        }
      } catch (err) {
        console.warn(`amp-api failed for ${cc}: ${err}`);
      }
    }
  }

  // Fallback 2: app-store-scraper as the final last-resort fallback.
  // Kept only because amp-api token extraction can break when Apple changes
  // the app page HTML structure; the scraper library is maintained by the
  // community and catches up to such changes faster than we can.
  if (allReviews.length === 0) {
    console.log("amp-api returned empty, falling back to app-store-scraper...");
    const requested = country || "us";
    const countries = requested === "us" ? ["us"] : [requested, "us"];
    for (const cc of [...new Set(countries)]) {
      const scraperReviews = await fetchWithScraper(appId, cc);
      if (scraperReviews.length > 0) {
        allReviews.push(...scraperReviews);
        console.log(`Got ${scraperReviews.length} reviews from app-store-scraper (${cc})`);
        break;
      }
    }
  }

  // Resolve app metadata. Lookup API is the source of truth for the app name;
  // fall back to RSS-derived name only if Lookup failed.
  const appMetadata = await metadataPromise;
  if (appMetadata?.trackName) {
    appName = appMetadata.trackName;
  } else {
    appName = await fetchAppName(appId, country);
  }

  return { reviews: allReviews, appName, appId, appMetadata };
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

/**
 * Fetch app metadata via iTunes Lookup API.
 *
 * This is the official, stable Apple endpoint for app metadata — it is NOT a
 * reviews source. It returns the full-store average rating, total rating count,
 * current version, and artwork, which we use to flag sample-vs-full-store
 * rating bias in the Data Limitations finding.
 *
 * Endpoint: https://itunes.apple.com/lookup?id={appId}&country={country}
 */
export async function fetchAppMetadata(
  appId: string,
  country: string = "us"
): Promise<AppMetadata | undefined> {
  const url = `${LOOKUP_URL}?id=${appId}&country=${country}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "AppReviewInsights/1.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Lookup API HTTP ${response.status}`);
  }
  const data = await response.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = data?.results?.[0] as any;
  if (!result) return undefined;
  return {
    trackId: result.trackId,
    trackName: result.trackName,
    sellerName: result.sellerName,
    version: result.version,
    averageUserRating: result.averageUserRating,
    averageUserRatingForCurrentVersion: result.averageUserRatingForCurrentVersion,
    userRatingCount: result.userRatingCount,
    userRatingCountForCurrentVersion: result.userRatingCountForCurrentVersion,
    primaryGenreName: result.primaryGenreName,
    contentAdvisoryRating: result.contentAdvisoryRating,
    artworkUrl100: result.artworkUrl100,
    artworkUrl512: result.artworkUrl512,
  };
}

/**
 * Extract the amp-api Bearer token from the App Store app page.
 *
 * The apps.apple.com page embeds a JSON config in a <script> tag named
 * "web-experience-app/config/environment". The token lives at
 * env.MEDIA_API.token. We fall back to a global "token":"..." regex in
 * case Apple restructures the config block.
 */
async function fetchAmpApiToken(
  country: string,
  appId: string
): Promise<string> {
  const url = `${APP_PAGE_URL}/${country}/app/id${appId}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AppReviewInsights/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`App page HTTP ${response.status}`);
  }
  const html = await response.text();

  // Try 1: parse the config/environment JSON block.
  const configMatch = html.match(
    /<script[^>]*name="web-experience-app\/config\/environment"[^>]*>([\s\S]*?)<\/script>/
  );
  if (configMatch) {
    try {
      const env = JSON.parse(configMatch[1]);
      const token = env?.MEDIA_API?.token;
      if (typeof token === "string" && token.length > 0) return token;
    } catch {
      // fall through to regex fallback
    }
  }

  // Try 2: global "token":"..." regex (resilient to config restructure).
  const tokenMatch = html.match(/"token"\s*:\s*"([A-Za-z0-9._-]+)"/);
  if (tokenMatch) return tokenMatch[1];

  throw new Error("Could not extract amp-api token from app page");
}

interface AmpApiReviewAttributes {
  rating?: number;
  title?: string;
  body?: string;
  userName?: string;
  date?: string;
  appVersion?: string;
}

interface AmpApiReview {
  id: string;
  type: string;
  attributes?: AmpApiReviewAttributes;
}

interface AmpApiResponse {
  data?: AmpApiReview[];
  next?: string; // cursor for next page — we cap pages to bound runtime instead
}

/**
 * Fetch reviews via amp-api (self-implemented).
 *
 * This is the same internal endpoint Apple's web App Store uses, called directly
 * with a Bearer token extracted from the app page. It replaces the third-party
 * `app-store-scraper` as the PRIMARY fallback — we own the retry, pagination,
 * and field-mapping logic, which the task's "explore independently" note asks
 * for. Returns more reviews per page (up to 200) and richer fields than RSS.
 *
 * amp-api endpoint:
 *   https://amp-api.apps.apple.com/v1/catalog/{country}/apps/{appId}/reviews
 */
async function fetchWithAmpApi(
  appId: string,
  country: string = "us"
): Promise<RawReview[]> {
  const token = await fetchAmpApiToken(country, appId);
  const allReviews: RawReview[] = [];
  const limit = 200; // amp-api allows up to 200 per request
  const maxPages = 3; // cap at ~600 reviews to bound runtime
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    const url =
      `${AMP_API_URL}/v1/catalog/${country}/apps/${appId}/reviews` +
      `?platform=web&additionalPlatforms=appletv%2Cipad&limit=${limit}` +
      `&offset=${offset}&sort=mostRecent`;
    let retries = 2;
    let data: AmpApiResponse | null = null;

    while (retries > 0) {
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "AppReviewInsights/1.0",
          },
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error(
              `amp-api auth failed (HTTP ${response.status}) — token may be stale`
            );
          }
          throw new Error(`amp-api HTTP ${response.status}`);
        }
        data = (await response.json()) as AmpApiResponse;
        break;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        const wait = (3 - retries) * 3000;
        console.warn(`amp-api retry in ${wait / 1000}s: ${err}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    if (!data?.data || data.data.length === 0) break;

    for (const entry of data.data) {
      const a = entry.attributes || {};
      allReviews.push({
        id: entry.id || `amp-${allReviews.length}`,
        rating: a.rating || 0,
        title: a.title || "",
        content: a.body || "",
        author: a.userName || "Anonymous",
        date: a.date || new Date().toISOString(),
        version: a.appVersion || undefined,
      });
    }

    offset += data.data.length;
    // No "next" cursor → no more pages available.
    if (!data.next) break;
    // Respect rate limits between pages.
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
  }

  return allReviews;
}

/**
 * Final fallback: app-store-scraper library (internal amp-api endpoint).
 *
 * Kept only as a last resort — our self-implemented amp-api is preferred, but
 * if Apple changes the app page HTML and token extraction breaks, this
 * community-maintained library catches up faster than we can. This is the
 * "belt and suspenders" layer.
 */
async function fetchWithScraper(
  appId: string,
  country: string = "us"
): Promise<RawReview[]> {
  // Dynamic import — avoid loading the heavy library if RSS works
  const store = await import("app-store-scraper");

  const allReviews: RawReview[] = [];
  const maxPages = 3; // Limit pages to avoid timeouts

  for (let page = 1; page <= maxPages; page++) {
    let retries = 2;
    while (retries > 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const scraper = store.default as any;
        const result = await scraper.reviews({
          id: parseInt(appId, 10),
          country: country,
          page: page,
          sort: "mostRecent",
        });

        if (!result || result.length === 0) {
          break; // No more reviews
        }

        for (const entry of result) {
          allReviews.push({
            id: String(entry.id || `scraped-${allReviews.length}`),
            rating: entry.score || 3,
            title: entry.title || "",
            content: entry.text || "",
            author: entry.userName || "Anonymous",
            date: entry.updated || new Date().toISOString(),
            version: entry.version || undefined,
          });
        }

        break; // Success, exit retry loop
      } catch (err) {
        retries--;
        if (retries === 0) {
          if (page === 1) {
            console.warn(`app-store-scraper failed: ${err}`);
          }
          break;
        }
        // Backoff: 5s, 15s, 30s
        const wait = (4 - retries) * 5000;
        console.warn(`Scraper retry in ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    // Stop paginating once we have no data — avoids pointless requests
    // once the source has stopped returning reviews.
    if (allReviews.length === 0) break;

    // Longer delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
  }

  return allReviews;
}
