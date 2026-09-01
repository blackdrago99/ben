import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type SearchResult = {
  url: string;
  title: string;
  snippet: string;
};

type StatusEvent =
  | { step: "searching"; message: string; query: string }
  | { step: "found"; count: number; urls: string[]; query: string }
  | { step: "extracting"; message: string }
  | { step: "done"; snippets: string[]; urls: string[]; titles: string[] }
  | { step: "error"; message: string };

function sendEvent(
  encoder: TextEncoder,
  event: StatusEvent,
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Perform a real web search using DuckDuckGo's HTML endpoint (no API key required).
 * Returns up to `numResults` results with title, URL, and a short snippet.
 */
async function webSearch(query: string, numResults = 5): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // Primary: DuckDuckGo HTML endpoint — free, no key, legitimate
  try {
    const ddgRes = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (ddgRes.ok) {
      const html = await ddgRes.text();
      // DDG result links are in <a class="result__a" href="...">
      // Result snippets are in <a class="result__snippet" ...>
      const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(html)) !== null && results.length < numResults) {
        let href = match[1];
        // DDG uses redirect links like //duckduckgo.com/l/?uddg=<encoded url>
        const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
        if (uddgMatch) {
          href = decodeURIComponent(uddgMatch[1]);
        } else if (href.startsWith("//")) {
          href = "https:" + href;
        }
        if (
          href.startsWith("http") &&
          !href.includes("duckduckgo.com") &&
          !href.includes("duck.com") &&
          !seen.has(href)
        ) {
          seen.add(href);
          const title = match[2].replace(/<[^>]+>/g, "").trim();
          results.push({ url: href, title, snippet: "" });
        }
      }

      // Extract snippets
      const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      let sMatch: RegExpExecArray | null;
      let idx = 0;
      while ((sMatch = snippetRegex.exec(html)) !== null && idx < results.length) {
        results[idx].snippet = sMatch[1]
          .replace(/<[^>]+>/g, "")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, " ")
          .trim();
        idx++;
      }
    }
  } catch {
    // fall through to Google fallback
  }

  // Fallback: Google search HTML (still no key)
  if (results.length === 0) {
    try {
      const googleRes = await fetch(
        `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${numResults}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (googleRes.ok) {
        const html = await googleRes.text();
        const linkRegex = /href="\/url\?q=([^"&]+)"/g;
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(html)) !== null && results.length < numResults) {
          const href = decodeURIComponent(match[1]);
          if (href.startsWith("http") && !href.includes("google.com") && !seen.has(href)) {
            seen.add(href);
            results.push({ url: href, title: "", snippet: "" });
          }
        }
      }
    } catch {
      // both failed
    }
  }

  return results.slice(0, numResults);
}

/**
 * Fetch and extract readable text content from a URL.
 * Strips HTML tags, scripts, styles, and returns clean text (max ~2000 chars).
 */
async function extractTextFromUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) return "";

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return "";
    }

    const html = await res.text();

    // Remove script and style blocks entirely
    let cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ");

    // Try to find main content area
    const mainMatch = cleaned.match(/<(?:main|article|div)[^>]*class="[^"]*(?:content|main|article|post|entry)[^"]*"[^>]*>([\s\S]*?)<\/(?:main|article|div)>/i);
    if (mainMatch) {
      cleaned = mainMatch[1];
    }

    // Extract code blocks first (preserve them with formatting)
    const codeBlocks: string[] = [];
    const codeRegex = /<(?:pre|code)[^>]*>([\s\S]*?)<\/(?:pre|code)>/gi;
    let codeMatch: RegExpExecArray | null;
    while ((codeMatch = codeRegex.exec(cleaned)) !== null) {
      const code = codeMatch[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .trim();
      if (code.length > 20 && code.length < 3000) {
        codeBlocks.push(code);
      }
    }

    // Strip all remaining HTML tags
    const text = cleaned
      .replace(/<[^>]+>/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Combine code blocks + text, limited to 2000 chars for low-RAM optimization
    let result = "";
    if (codeBlocks.length > 0) {
      result += codeBlocks.slice(0, 2).join("\n\n") + "\n\n";
    }
    result += text.slice(0, 2000 - result.length);

    return result.trim();
  } catch {
    return "";
  }
}

/**
 * Basic relevance filter: checks if extracted text contains query terms.
 * Returns only results that have at least one query word in the text or title.
 */
function filterRelevant(
  query: string,
  results: { url: string; title: string; text: string }[],
): { url: string; title: string; text: string }[] {
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/[^a-z0-9]/g, ""));

  if (queryTerms.length === 0) return results;

  return results.filter((r) => {
    const combined = (r.title + " " + r.text).toLowerCase();
    const matchCount = queryTerms.filter((term) => combined.includes(term)).length;
    // Require at least 30% of query terms to match
    return matchCount >= Math.max(1, Math.ceil(queryTerms.length * 0.3));
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { query, refine_query } = await req.json();
    const searchQuery = refine_query || query;
    if (!searchQuery || typeof searchQuery !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing 'query' field" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Step 1: Searching
          controller.enqueue(
            sendEvent(encoder, {
              step: "searching",
              message: "Searching the web...",
              query: searchQuery,
            }),
          );

          const searchResults = await webSearch(searchQuery, 5);

          // Step 2: Found results
          controller.enqueue(
            sendEvent(encoder, {
              step: "found",
              count: searchResults.length,
              urls: searchResults.map((r) => r.url),
              query: searchQuery,
            }),
          );

          if (searchResults.length === 0) {
            controller.enqueue(
              sendEvent(encoder, { step: "done", snippets: [], urls: [], titles: [] }),
            );
            controller.close();
            return;
          }

          // Step 3: Extracting content
          controller.enqueue(
            sendEvent(encoder, { step: "extracting", message: "Extracting relevant content..." }),
          );

          const extracted: { url: string; title: string; text: string }[] = [];
          for (const r of searchResults) {
            const text = await extractTextFromUrl(r.url);
            if (text) {
              extracted.push({ url: r.url, title: r.title, text });
            }
          }

          // Step 4: Filter for relevance
          const relevant = filterRelevant(searchQuery, extracted);

          // If nothing passed the filter, use all extracted results
          const finalResults = relevant.length > 0 ? relevant : extracted;

          // Build snippets — each is a formatted text block with source info
          const snippets = finalResults.map(
            (r, i) =>
              `[Source ${i + 1}: ${r.title || r.url}]\n${r.text}`,
          );

          controller.enqueue(
            sendEvent(encoder, {
              step: "done",
              snippets,
              urls: finalResults.map((r) => r.url),
              titles: finalResults.map((r) => r.title),
            }),
          );

          controller.close();
        } catch (err) {
          controller.enqueue(
            sendEvent(encoder, {
              step: "error",
              message: err instanceof Error ? err.message : "Unknown search error",
            }),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
