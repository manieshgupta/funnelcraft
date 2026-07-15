const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

/**
 * Crawls a website up to a maximum number of pages.
 * @param {string} startUrl - The entrypoint URL.
 * @param {number} maxPages - The maximum number of pages to crawl.
 * @returns {Promise<Array<{url: string, title: string, content: string}>>}
 */
async function crawlWebsite(startUrl, maxPages = 15) {
  const visited = new Set();
  const pages = [];
  const queue = [startUrl];
  let startHost;

  try {
    const startParsed = new URL(startUrl);
    startHost = startParsed.hostname.replace(/^www\./, '');
  } catch (e) {
    console.error('[Crawler] Invalid start URL:', startUrl);
    return [];
  }

  while (queue.length > 0 && visited.size < maxPages) {
    const currentUrl = queue.shift();
    
    // Normalize URL
    let normalizedUrl;
    try {
      const parsed = new URL(currentUrl, startUrl);
      parsed.hash = '';
      normalizedUrl = parsed.toString().replace(/\/$/, '');
      
      // Keep only within the same host domain (strip www. prefix)
      const parsedHost = parsed.hostname.replace(/^www\./, '');
      if (parsedHost !== startHost) continue;
    } catch (e) {
      continue;
    }

    if (visited.has(normalizedUrl)) continue;
    visited.add(normalizedUrl);

    console.log(`[Crawler] Fetching: ${normalizedUrl} (${visited.size}/${maxPages})`);
    try {
      const response = await axios.get(normalizedUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const contentType = response.headers['content-type'] || '';
      if (!contentType.includes('text/html')) {
        continue;
      }

      const $ = cheerio.load(response.data);

      // Find all hyperlinks and enqueue them BEFORE stripping structural elements
      $('a[href]').each((i, el) => {
        const href = $(el).attr('href');
        try {
          const nextUrl = new URL(href, normalizedUrl);
          const nextHost = nextUrl.hostname.replace(/^www\./, '');
          if (nextHost === startHost) {
            nextUrl.hash = '';
            const nextStr = nextUrl.toString().replace(/\/$/, '');
            if (!visited.has(nextStr) && !queue.includes(nextStr)) {
              queue.push(nextStr);
            }
          }
        } catch (e) {
          // ignore invalid URLs
        }
      });

      // Remove structural/non-content nodes for text extraction
      $('script, style, nav, footer, header, noscript, iframe, svg, form').remove();

      // Extract semantic text from the body
      const textContent = $('body')
        .find('h1, h2, h3, h4, h5, h6, p, li')
        .map((i, el) => $(el).text().trim())
        .get()
        .filter(text => text.length > 15) // filter out tiny fragments
        .join('\n\n');

      const title = $('title').text().trim() || normalizedUrl;

      pages.push({
        url: normalizedUrl,
        title,
        content: textContent
      });

    } catch (error) {
      console.error(`[Crawler] Failed to fetch ${normalizedUrl}:`, error.message);
    }
  }

  console.log(`[Crawler] Completed crawling. Crawled ${pages.length} pages.`);
  return pages;
}

module.exports = { crawlWebsite };
