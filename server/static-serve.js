'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function createStaticServe({ distDir, token }) {
  const assetsDir = path.join(distDir, 'assets');

  function injectToken(html) {
    const meta = `<meta name="vdl-token" content="${escapeHtml(token)}">`;
    if (html.includes('name="vdl-token"'))
      return html.replace(/<meta\s+name="vdl-token"[^>]*>/i, meta);
    if (html.includes('</head>'))
      return html.replace('</head>', `  ${meta}\n</head>`);
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n  ${meta}`);
  }

  return async function staticServe(ctx, next) {
    const { method, path: urlPath } = ctx;
    if (method !== 'GET' && method !== 'HEAD') return next();

    const isApiPath = urlPath.startsWith('/api/') || urlPath === '/api'
      || urlPath.startsWith('/healthz') || urlPath.startsWith('/version');
    if (isApiPath) return next();

    if (urlPath.startsWith('/assets/')) {
      const rel = urlPath.replace(/^\/assets\//, '');
      const filePath = path.join(assetsDir, rel);
      if (!filePath.startsWith(assetsDir + path.sep)) { ctx.status = 403; return; }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();
      const ext = path.extname(filePath).toLowerCase();
      ctx.type = MIME[ext] || 'application/octet-stream';
      ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
      ctx.body = fs.createReadStream(filePath);
      return;
    }

    const indexPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexPath)) return next();
    const html = fs.readFileSync(indexPath, 'utf8');
    ctx.type = 'text/html; charset=utf-8';
    ctx.set('Cache-Control', 'no-store');
    ctx.body = injectToken(html);
  };
}

module.exports = { createStaticServe };
