'use strict';
const fs    = require('fs');
const path  = require('path');
const https = require('follow-redirects').https;
const http  = require('follow-redirects').http;

/**
 * Download a file with progress reporting and optional custom headers.
 * Handles redirects automatically via follow-redirects.
 *
 * @param {string}   url
 * @param {string}   dest        - destination file path
 * @param {function} onProgress  - called with (pct 0-100)
 * @param {object}   headers     - optional HTTP headers (e.g. User-Agent)
 */
function downloadFile(url, dest, onProgress = () => {}, headers = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const proto = url.startsWith('https') ? https : http;
    const tmp   = dest + '.tmp';

    // Remove stale tmp file from a previous failed attempt
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}

    const stream = fs.createWriteStream(tmp);

    const options = {
      maxRedirects: 15,
      timeout:      60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      },
    };

    const cleanup = () => {
      try { stream.destroy(); } catch {}
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    };

    proto.get(url, options, (res) => {
      // follow-redirects already handles 301/302 automatically,
      // but handle unexpected 3xx just in case
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        cleanup();
        return downloadFile(res.headers.location, dest, onProgress, headers)
          .then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        cleanup();
        return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;

      res.on('data', chunk => {
        downloaded += chunk.length;
        stream.write(chunk);
        if (total > 0) onProgress(Math.round((downloaded / total) * 100));
      });

      res.on('end', () => {
        stream.end(() => {
          try {
            fs.renameSync(tmp, dest);
            resolve();
          } catch (e) {
            cleanup();
            reject(e);
          }
        });
      });

      res.on('error', err => { cleanup(); reject(err); });
    }).on('error', err => { cleanup(); reject(err); });
  });
}

/**
 * Fetch JSON from a URL.
 */
async function fetchJSON(url, headers = {}) {
  const fetch = require('node-fetch');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept':     'application/json',
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

/**
 * Download multiple files in parallel with limited concurrency.
 * Items can include a `headers` field for per-file custom headers.
 *
 * @param {Array}    items        - [{ url, dest, headers?, displayName? }]
 * @param {number}   concurrency
 * @param {function} onEach       - called with (item, error|null) for each file
 * @returns {Array} failed items (with .error set)
 */
async function downloadBatch(items, concurrency = 5, onEach = () => {}) {
  const failed = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      try {
        if (!fs.existsSync(item.dest)) {
          await downloadFile(item.url, item.dest, () => {}, item.headers || {});
        }
        onEach(item, null);
      } catch (e) {
        failed.push({ ...item, error: e.message });
        onEach(item, e);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return failed;
}

module.exports = { downloadFile, fetchJSON, downloadBatch };
