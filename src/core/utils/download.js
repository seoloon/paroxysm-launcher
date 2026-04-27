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
 * @param {object}   options     - { preferRemoteFilename?: boolean }
 */
function downloadFile(url, dest, onProgress = () => {}, headers = {}, options = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const proto = url.startsWith('https') ? https : http;
    const tmp   = dest + '.tmp';

    // Remove stale tmp file from a previous failed attempt
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}

    const stream = fs.createWriteStream(tmp);

    const requestOptions = {
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

    proto.get(url, requestOptions, (res) => {
      // follow-redirects already handles 301/302 automatically,
      // but handle unexpected 3xx just in case
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        cleanup();
        return downloadFile(res.headers.location, dest, onProgress, headers, options)
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
            const remoteFilename = getRemoteFilename(res);
            let finalDest = dest;

            if (options.preferRemoteFilename && remoteFilename) {
              const safeRemote = sanitizeRemoteFilename(remoteFilename);
              if (safeRemote) {
                finalDest = ensureUniquePath(path.join(path.dirname(dest), safeRemote));
              }
            }

            fs.renameSync(tmp, finalDest);
            resolve({ dest: finalDest, remoteFilename });
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
          const result = await downloadFile(
            item.url,
            item.dest,
            () => {},
            item.headers || {},
            { preferRemoteFilename: !!item.preferRemoteFilename }
          );
          if (result?.dest && result.dest !== item.dest) item.dest = result.dest;
          if (!item.displayName && result?.remoteFilename) item.displayName = result.remoteFilename;
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

function getRemoteFilename(res) {
  const cd = res?.headers?.['content-disposition'];
  const fromCd = parseContentDispositionFilename(cd);
  if (fromCd) return fromCd;

  const responseUrl = res?.responseUrl;
  if (responseUrl) {
    try {
      const pathname = new URL(responseUrl).pathname || '';
      const base = decodeURIComponent(path.basename(pathname));
      if (base && base !== '/' && base !== '.') return base;
    } catch {}
  }
  return null;
}

function parseContentDispositionFilename(cd) {
  if (!cd || typeof cd !== 'string') return null;
  const utf8 = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try { return decodeURIComponent(utf8[1].trim().replace(/^"(.*)"$/, '$1')); } catch {}
  }
  const plain = cd.match(/filename\s*=\s*("?)([^";]+)\1/i);
  if (plain?.[2]) return plain[2].trim();
  return null;
}

function sanitizeRemoteFilename(n) {
  if (!n || typeof n !== 'string') return '';
  return n.replace(/[/\\:*?"<>|]/g, '_').trim();
}

function ensureUniquePath(candidate) {
  if (!fs.existsSync(candidate)) return candidate;
  const dir = path.dirname(candidate);
  const ext = path.extname(candidate);
  const base = path.basename(candidate, ext);
  for (let i = 1; i < 1000; i++) {
    const next = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(next)) return next;
  }
  return candidate;
}

module.exports = { downloadFile, fetchJSON, downloadBatch };
