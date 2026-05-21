export function getAdminHTML(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zo Gateway - 号池管理</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
    h1 { font-size: 1.8rem; font-weight: 700; color: #fff; margin-bottom: 4px; }
    .subtitle { color: #888; margin-bottom: 32px; }
    .card { background: #111; border: 1px solid #222; border-radius: 12px; padding: 24px; margin: 16px 0; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; }
    .stat-box { flex: 1; background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 16px; text-align: center; }
    .stat-num { font-size: 2rem; font-weight: 700; color: #7c9eff; }
    .stat-label { font-size: 0.85rem; color: #888; margin-top: 4px; }
    .stat-box.green .stat-num { color: #4ade80; }
    .stat-box.red .stat-num { color: #f87171; }

    /* Login */
    #login-view { max-width: 400px; margin: 120px auto; }
    #login-view h2 { color: #fff; margin-bottom: 16px; text-align: center; }
    .input-group { margin-bottom: 16px; }
    .input-group label { display: block; color: #aaa; margin-bottom: 6px; font-size: 0.9rem; }
    input[type="text"], input[type="password"] {
      width: 100%; padding: 10px 14px; background: #1a1a2e; border: 1px solid #333;
      border-radius: 8px; color: #e0e0e0; font-size: 1rem; outline: none;
    }
    input:focus { border-color: #7c9eff; }
    textarea {
      width: 100%; padding: 10px 14px; background: #1a1a2e; border: 1px solid #333;
      border-radius: 8px; color: #e0e0e0; font-size: 0.9rem; outline: none;
      font-family: 'SF Mono', Monaco, monospace; resize: vertical; min-height: 100px;
    }
    textarea:focus { border-color: #7c9eff; }
    .btn {
      padding: 10px 20px; border: none; border-radius: 8px; font-size: 0.95rem;
      cursor: pointer; font-weight: 600; transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.85; }
    .btn-primary { background: #7c9eff; color: #0a0a0a; }
    .btn-danger { background: #f87171; color: #fff; }
    .btn-sm { padding: 6px 14px; font-size: 0.8rem; }
    .btn-outline { background: transparent; border: 1px solid #333; color: #aaa; }
    .btn-outline:hover { border-color: #7c9eff; color: #7c9eff; }
    .btn-success { background: #4ade80; color: #0a0a0a; }

    /* Token list */
    .token-table { width: 100%; border-collapse: collapse; }
    .token-table th { text-align: left; color: #888; font-weight: 600; font-size: 0.85rem; padding: 8px 12px; border-bottom: 1px solid #222; }
    .token-table td { padding: 12px; border-bottom: 1px solid #1a1a1a; vertical-align: middle; }
    .token-text { font-family: 'SF Mono', Monaco, monospace; font-size: 0.85rem; color: #7c9eff; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .badge-on { background: #1a3a2e; color: #4ade80; }
    .badge-off { background: #3a1a1a; color: #f87171; }
    .badge-cool { background: #3a2a1a; color: #fbbf24; }
    .actions { display: flex; gap: 8px; }
    .empty { text-align: center; color: #555; padding: 40px; }

    /* Add form */
    .add-form { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
    .add-form .input-group { flex: 1; min-width: 200px; margin-bottom: 0; }

    .hidden { display: none; }
    .toast { position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px; font-size: 0.9rem; z-index: 1000; animation: fadeIn 0.3s; }
    .toast-ok { background: #1a3a2e; color: #4ade80; border: 1px solid #2d6a4f; }
    .toast-err { background: #3a1a1a; color: #f87171; border: 1px solid #7f1d1d; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }

    .base-url-box { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 12px 16px; font-family: monospace; font-size: 0.95rem; color: #7c9eff; word-break: break-all; margin: 12px 0; }
    .info-row { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 16px; }
    .info-row p { color: #888; font-size: 0.85rem; }
    .info-row strong { color: #aaa; }

    .bulk-area { margin-top: 12px; }
    .bulk-hint { color: #666; font-size: 0.8rem; margin-top: 4px; }
  </style>
</head>
<body>

<!-- Login -->
<div id="login-view">
  <div class="card">
    <h2>号池管理</h2>
    <p style="color:#888;text-align:center;margin-bottom:20px;">输入 Gateway Key 登录</p>
    <div class="input-group">
      <label>Gateway Key</label>
      <input type="password" id="login-key" placeholder="sk-..." autofocus>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="login()">登录</button>
  </div>
</div>

<!-- Dashboard -->
<div id="dashboard-view" class="hidden">
  <div class="container">
    <h1>号池管理</h1>
    <p class="subtitle">Zo Computer API Gateway Token 管理面板</p>

    <div class="stats">
      <div class="stat-box"><div class="stat-num" id="stat-total">0</div><div class="stat-label">总计</div></div>
      <div class="stat-box green"><div class="stat-num" id="stat-available">0</div><div class="stat-label">可用</div></div>
      <div class="stat-box red"><div class="stat-num" id="stat-disabled">0</div><div class="stat-label">已禁用</div></div>
    </div>

    <div class="card">
      <h3 style="color:#fff;margin-bottom:16px;">添加 Token</h3>
      <div class="add-form">
        <div class="input-group">
          <label>备注名</label>
          <input type="text" id="add-label" placeholder="例如：账号1">
        </div>
        <div class="input-group" style="flex:2">
          <label>Zo Access Token</label>
          <input type="text" id="add-token" placeholder="zo_sk_...">
        </div>
        <button class="btn btn-primary" onclick="addToken()">添加</button>
      </div>
      <div class="bulk-area">
        <button class="btn btn-outline btn-sm" onclick="toggleBulk()">批量导入</button>
        <div id="bulk-box" class="hidden" style="margin-top:12px;">
          <textarea id="bulk-tokens" placeholder="每行一个 Token，格式：&#10;zo_sk_token1&#10;备注名:zo_sk_token2&#10;账号3:zo_sk_token3"></textarea>
          <p class="bulk-hint">每行一个 Token。可选格式 "备注名:token"，不写备注名则自动编号。</p>
          <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="bulkAdd()">批量添加</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="color:#fff;margin-bottom:16px;">Token 列表</h3>
      <table class="token-table">
        <thead><tr><th>备注</th><th>Token</th><th>添加时间</th><th>状态</th><th>操作</th></tr></thead>
        <tbody id="token-list"></tbody>
      </table>
      <div id="empty-msg" class="empty hidden">还没有 Token，点击上方添加</div>
    </div>

    <div class="card">
      <h3 style="color:#fff;margin-bottom:12px;">接入信息</h3>
      <p style="color:#aaa;">Base URL</p>
      <div class="base-url-box">${baseUrl}</div>
      <div class="info-row">
        <p><strong>API Key：</strong>你的 Gateway Key</p>
        <p><strong>模型：</strong>claude-opus-4-7 / claude-sonnet-4</p>
      </div>
    </div>
  </div>
</div>

<script>
const BASE = '${baseUrl}';
let authKey = '';

function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function maskToken(t) {
  if (t.length <= 12) return t;
  return t.slice(0, 8) + '...' + t.slice(-4);
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authKey } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function login() {
  authKey = document.getElementById('login-key').value.trim();
  if (!authKey) return toast('请输入 Gateway Key', false);
  try {
    await api('GET', '/admin/tokens');
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('dashboard-view').classList.remove('hidden');
    loadTokens();
  } catch (e) {
    toast('登录失败：' + e.message, false);
  }
}

document.getElementById('login-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

async function loadTokens() {
  try {
    const data = await api('GET', '/admin/tokens');
    renderTokens(data.tokens, data.pool_status);
  } catch (e) { toast('加载失败：' + e.message, false); }
}

function renderTokens(tokens, poolStatus) {
  document.getElementById('stat-total').textContent = tokens.length;
  const enabled = tokens.filter(t => t.enabled).length;
  document.getElementById('stat-available').textContent = enabled;
  document.getElementById('stat-disabled').textContent = tokens.length - enabled;

  const tbody = document.getElementById('token-list');
  const empty = document.getElementById('empty-msg');
  if (tokens.length === 0) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  tbody.innerHTML = tokens.map(t => {
    const status = t.enabled ? '<span class="badge badge-on">启用</span>' : '<span class="badge badge-off">禁用</span>';
    const date = new Date(t.addedAt).toLocaleDateString('zh-CN');
    const toggleLabel = t.enabled ? '禁用' : '启用';
    const toggleClass = t.enabled ? 'btn-outline' : 'btn-success';
    return \`<tr>
      <td>\${t.label}</td>
      <td><span class="token-text">\${maskToken(t.token)}</span></td>
      <td style="color:#888;font-size:0.85rem">\${date}</td>
      <td>\${status}</td>
      <td class="actions">
        <button class="btn btn-sm \${toggleClass}" onclick="toggleTk('\${t.token}', \${!t.enabled})">\${toggleLabel}</button>
        <button class="btn btn-sm btn-danger" onclick="removeTk('\${t.token}')">删除</button>
      </td>
    </tr>\`;
  }).join('');
}

async function addToken() {
  const label = document.getElementById('add-label').value.trim() || '未命名';
  const token = document.getElementById('add-token').value.trim();
  if (!token) return toast('请输入 Token', false);
  try {
    await api('POST', '/admin/tokens', { token, label });
    document.getElementById('add-label').value = '';
    document.getElementById('add-token').value = '';
    toast('添加成功');
    loadTokens();
  } catch (e) { toast(e.message, false); }
}

function toggleBulk() {
  document.getElementById('bulk-box').classList.toggle('hidden');
}

async function bulkAdd() {
  const raw = document.getElementById('bulk-tokens').value.trim();
  if (!raw) return toast('请输入 Token', false);
  const lines = raw.split('\\n').map(l => l.trim()).filter(Boolean);
  let added = 0, failed = 0;
  for (const line of lines) {
    let label = '', token = '';
    if (line.includes(':')) {
      const idx = line.indexOf(':');
      label = line.slice(0, idx).trim();
      token = line.slice(idx + 1).trim();
    } else {
      token = line;
      label = 'Token-' + (added + 1);
    }
    try {
      await api('POST', '/admin/tokens', { token, label });
      added++;
    } catch { failed++; }
  }
  document.getElementById('bulk-tokens').value = '';
  toast(\`批量导入完成：\${added} 成功，\${failed} 失败\`);
  loadTokens();
}

async function removeTk(token) {
  if (!confirm('确定删除这个 Token？')) return;
  try {
    await api('DELETE', '/admin/tokens', { token });
    toast('已删除');
    loadTokens();
  } catch (e) { toast(e.message, false); }
}

async function toggleTk(token, enabled) {
  try {
    await api('PATCH', '/admin/tokens', { token, enabled });
    toast(enabled ? '已启用' : '已禁用');
    loadTokens();
  } catch (e) { toast(e.message, false); }
}
</script>
</body>
</html>`;
}
