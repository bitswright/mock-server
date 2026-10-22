// Lightweight mock API server — zero dependencies (pure Node.js).
// - Define/edit mock API routes & responses at runtime via a web UI (http://localhost:PORT/admin)
// - Each configured route is served live at its own path, returning whatever you set.
// - Config is persisted to routes.json so it survives restarts.
// Run with: node server.js   (optionally PORT=4000 node server.js)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'routes.json');

// ---------- storage ----------
function loadRoutes() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveRoutes(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let routes = loadRoutes(); // [{ id, method, path, status, headers, body, delayMs, enabled }]

function nextId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function findRoute(method, urlPath) {
  return routes.find(
    r => r.enabled !== false && r.method === method && r.path === urlPath
  );
}

// ---------- helpers ----------
function sendJSON(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJSONSafe(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // --- Admin UI ---
  if (method === 'GET' && pathname === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(ADMIN_HTML);
  }

  // --- Admin API ---
  if (pathname === '/admin/api/routes' && method === 'GET') {
    return sendJSON(res, 200, routes);
  }

  if (pathname === '/admin/api/routes' && method === 'POST') {
    const bodyText = await readBody(req);
    const data = parseJSONSafe(bodyText);
    if (!data.method || !data.path) {
      return sendJSON(res, 400, { error: 'method and path are required' });
    }
    const route = {
      id: nextId(),
      method: data.method.toUpperCase(),
      path: data.path.startsWith('/') ? data.path : '/' + data.path,
      status: Number(data.status) || 200,
      headers: data.headers && typeof data.headers === 'object' ? data.headers : {},
      body: data.body === undefined ? {} : data.body,
      delayMs: Number(data.delayMs) || 0,
      enabled: true,
    };
    routes.push(route);
    saveRoutes(routes);
    return sendJSON(res, 201, route);
  }

  const routeIdMatch = pathname.match(/^\/admin\/api\/routes\/([^/]+)$/);
  if (routeIdMatch && method === 'PUT') {
    const id = routeIdMatch[1];
    const idx = routes.findIndex(r => r.id === id);
    if (idx === -1) return sendJSON(res, 404, { error: 'not found' });
    const bodyText = await readBody(req);
    const data = parseJSONSafe(bodyText);
    const r = routes[idx];
    if (data.method) r.method = data.method.toUpperCase();
    if (data.path) r.path = data.path.startsWith('/') ? data.path : '/' + data.path;
    if (data.status !== undefined) r.status = Number(data.status) || 200;
    if (data.headers && typeof data.headers === 'object') r.headers = data.headers;
    if (data.body !== undefined) r.body = data.body;
    if (data.delayMs !== undefined) r.delayMs = Number(data.delayMs) || 0;
    if (data.enabled !== undefined) r.enabled = !!data.enabled;
    saveRoutes(routes);
    return sendJSON(res, 200, r);
  }

  if (routeIdMatch && method === 'DELETE') {
    const id = routeIdMatch[1];
    routes = routes.filter(r => r.id !== id);
    saveRoutes(routes);
    res.writeHead(204);
    return res.end();
  }

  // --- Mock API catch-all ---
  const route = findRoute(method, pathname);
  if (!route) {
    return sendJSON(res, 404, {
      error: 'No mock configured for this route',
      method,
      path: pathname,
      hint: 'Configure it at /admin',
    });
  }

  const send = () => {
    const headers = Object.assign({}, route.headers || {});
    let bodyOut;
    if (typeof route.body === 'string') {
      bodyOut = route.body;
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'text/plain';
      }
    } else {
      bodyOut = JSON.stringify(route.body, null, 2);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }
    res.writeHead(route.status || 200, headers);
    res.end(bodyOut);
  };

  if (route.delayMs > 0) setTimeout(send, route.delayMs);
  else send();
});

server.listen(PORT, () => {
  console.log(`Mock server running at http://localhost:${PORT}`);
  console.log(`Admin UI at        http://localhost:${PORT}/admin`);
});

// ---------- inline admin page ----------
const ADMIN_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mock Server Admin</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 960px; margin: 32px auto; padding: 0 16px; }
  h1 { font-size: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #8884; vertical-align: top; }
  input, select, textarea { width: 100%; box-sizing: border-box; font-family: inherit; padding: 4px 6px; }
  textarea { min-height: 60px; font-family: ui-monospace, monospace; font-size: 12px; }
  button { padding: 6px 12px; cursor: pointer; }
  .row-actions { display: flex; gap: 6px; }
  form#addForm { display: grid; grid-template-columns: 100px 1fr 90px; gap: 8px; margin-top: 12px; align-items: start; }
  form#addForm .full { grid-column: 1 / -1; }
  .muted { opacity: 0.6; font-size: 12px; }
</style>
</head>
<body>
<h1>Mock Server &mdash; Routes</h1>
<p class="muted">Define a mock API here, then call it at the shown path. Edit any field and press Save to update it live.</p>

<table id="table">
  <thead>
    <tr><th>Method</th><th>Path</th><th>Status</th><th>Body (JSON or text)</th><th>Delay ms</th><th>On</th><th></th></tr>
  </thead>
  <tbody id="tbody"></tbody>
</table>

<h2 style="margin-top:32px;">Add new route</h2>
<form id="addForm">
  <select name="method"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select>
  <input name="path" placeholder="/api/example" />
  <input name="status" placeholder="200" value="200" />
  <textarea name="body" class="full" placeholder='{"message": "hello"}'></textarea>
  <input name="delayMs" placeholder="delay ms (optional)" />
  <button type="submit" class="full">Add route</button>
</form>

<script>
async function fetchRoutes() {
  const res = await fetch('/admin/api/routes');
  return res.json();
}

function bodyToText(b) {
  return typeof b === 'string' ? b : JSON.stringify(b, null, 2);
}

function parseBody(text) {
  try { return JSON.parse(text); } catch { return text; }
}

async function render() {
  const routes = await fetchRoutes();
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  routes.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = \`
      <td><input data-f="method" value="\${r.method}" style="width:70px"/></td>
      <td><input data-f="path" value="\${r.path}"/></td>
      <td><input data-f="status" value="\${r.status}" style="width:60px"/></td>
      <td><textarea data-f="body">\${bodyToText(r.body)}</textarea></td>
      <td><input data-f="delayMs" value="\${r.delayMs||0}" style="width:70px"/></td>
      <td><input type="checkbox" data-f="enabled" \${r.enabled!==false?'checked':''}/></td>
      <td class="row-actions">
        <button data-act="save">Save</button>
        <button data-act="delete">Delete</button>
      </td>
    \`;
    tr.querySelector('[data-act="save"]').onclick = async () => {
      const payload = {
        method: tr.querySelector('[data-f="method"]').value,
        path: tr.querySelector('[data-f="path"]').value,
        status: tr.querySelector('[data-f="status"]').value,
        body: parseBody(tr.querySelector('[data-f="body"]').value),
        delayMs: tr.querySelector('[data-f="delayMs"]').value,
        enabled: tr.querySelector('[data-f="enabled"]').checked,
      };
      await fetch('/admin/api/routes/' + r.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      render();
    };
    tr.querySelector('[data-act="delete"]').onclick = async () => {
      await fetch('/admin/api/routes/' + r.id, { method: 'DELETE' });
      render();
    };
    tbody.appendChild(tr);
  });
}

document.getElementById('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const payload = {
    method: f.method.value,
    path: f.path.value,
    status: f.status.value,
    body: parseBody(f.body.value || '{}'),
    delayMs: f.delayMs.value,
  };
  await fetch('/admin/api/routes', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  f.reset();
  render();
});

render();
</script>
</body>
</html>`;
