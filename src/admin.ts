export function getAdminHTML(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zo Gateway</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f4; color: #1c1917; line-height: 1.6; }

    /* Login */
    #login-view { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f5f5f4; }
    .login-card { background: #fff; border-radius: 16px; padding: 40px; width: 380px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .login-card h1 { font-size: 1.5rem; text-align: center; margin-bottom: 6px; color: #1c1917; }
    .login-card .sub { text-align: center; color: #a8a29e; margin-bottom: 28px; font-size: 0.9rem; }
    .login-card .logo { text-align: center; margin-bottom: 20px; font-size: 2.5rem; }

    /* Layout */
    #app { display: none; min-height: 100vh; }
    .sidebar { width: 220px; background: #fff; border-right: 1px solid #e7e5e4; position: fixed; top: 0; left: 0; bottom: 0; display: flex; flex-direction: column; z-index: 10; }
    .sidebar-logo { padding: 24px 20px 20px; display: flex; align-items: center; gap: 10px; font-size: 1.15rem; font-weight: 700; color: #1c1917; border-bottom: 1px solid #e7e5e4; }
    .sidebar-logo span.icon { font-size: 1.4rem; }
    .sidebar-nav { flex: 1; padding: 12px 8px; }
    .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; cursor: pointer; color: #78716c; font-size: 0.9rem; font-weight: 500; transition: all 0.15s; margin-bottom: 2px; }
    .nav-item:hover { background: #f5f5f4; color: #1c1917; }
    .nav-item.active { background: #1c1917; color: #fff; }
    .nav-item .nav-icon { font-size: 1.1rem; width: 22px; text-align: center; }
    .sidebar-footer { padding: 16px 20px; border-top: 1px solid #e7e5e4; }
    .sidebar-footer button { width: 100%; padding: 8px; background: none; border: 1px solid #e7e5e4; border-radius: 8px; cursor: pointer; color: #78716c; font-size: 0.85rem; transition: all 0.15s; }
    .sidebar-footer button:hover { background: #fef2f2; color: #ef4444; border-color: #fecaca; }

    .main { margin-left: 220px; padding: 28px 32px; min-height: 100vh; }
    .page { display: none; }
    .page.active { display: block; }
    .page-title { font-size: 1.4rem; font-weight: 700; color: #1c1917; margin-bottom: 24px; }

    /* Cards */
    .card { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 20px; border: 1px solid #e7e5e4; }
    .card h3 { font-size: 1rem; font-weight: 600; color: #1c1917; margin-bottom: 16px; }

    /* Stats */
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: #fff; border: 1px solid #e7e5e4; border-radius: 12px; padding: 20px; }
    .stat-card .label { font-size: 0.8rem; color: #a8a29e; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card .value { font-size: 2rem; font-weight: 700; margin-top: 4px; }
    .stat-card .value.blue { color: #3b82f6; }
    .stat-card .value.green { color: #22c55e; }
    .stat-card .value.red { color: #ef4444; }
    .stat-card .value.amber { color: #f59e0b; }

    /* Form */
    .input-group { margin-bottom: 14px; }
    .input-group label { display: block; font-size: 0.85rem; color: #78716c; margin-bottom: 5px; font-weight: 500; }
    input[type="text"], input[type="password"] {
      width: 100%; padding: 10px 14px; border: 1px solid #d6d3d1; border-radius: 8px;
      font-size: 0.9rem; color: #1c1917; background: #fff; outline: none; transition: border 0.15s;
    }
    input:focus { border-color: #1c1917; }
    textarea {
      width: 100%; padding: 10px 14px; border: 1px solid #d6d3d1; border-radius: 8px;
      font-size: 0.85rem; color: #1c1917; background: #fff; outline: none; resize: vertical;
      min-height: 100px; font-family: 'SF Mono', Monaco, monospace; transition: border 0.15s;
    }
    textarea:focus { border-color: #1c1917; }

    .btn { padding: 10px 20px; border: none; border-radius: 8px; font-size: 0.9rem; cursor: pointer; font-weight: 600; transition: all 0.15s; }
    .btn:hover { opacity: 0.9; }
    .btn-primary { background: #1c1917; color: #fff; }
    .btn-danger { background: #ef4444; color: #fff; }
    .btn-outline { background: #fff; border: 1px solid #d6d3d1; color: #78716c; }
    .btn-outline:hover { border-color: #1c1917; color: #1c1917; }
    .btn-success { background: #22c55e; color: #fff; }
    .btn-sm { padding: 6px 14px; font-size: 0.8rem; }
    .btn-block { width: 100%; }

    /* Table */
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 0.8rem; color: #a8a29e; font-weight: 600; padding: 10px 14px; border-bottom: 1px solid #e7e5e4; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 12px 14px; border-bottom: 1px solid #f5f5f4; font-size: 0.9rem; vertical-align: middle; }
    tr:hover td { background: #fafaf9; }
    .token-mono { font-family: 'SF Mono', Monaco, monospace; font-size: 0.82rem; color: #78716c; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
    .badge-on { background: #dcfce7; color: #16a34a; }
    .badge-off { background: #fee2e2; color: #dc2626; }
    .badge-ok { background: #dcfce7; color: #16a34a; }
    .badge-err { background: #fee2e2; color: #dc2626; }
    .badge-anthropic { background: #dbeafe; color: #2563eb; }
    .badge-openai { background: #fef3c7; color: #d97706; }
    .actions-cell { display: flex; gap: 6px; }
    .empty-state { text-align: center; color: #a8a29e; padding: 48px; font-size: 0.9rem; }

    /* Add form row */
    .add-row { display: flex; gap: 12px; align-items: flex-end; }
    .add-row .input-group { flex: 1; margin-bottom: 0; }
    .add-row .input-group:last-of-type { flex: 2; }

    /* Info */
    .code-box { background: #1c1917; color: #e7e5e4; border-radius: 8px; padding: 16px; font-family: 'SF Mono', Monaco, monospace; font-size: 0.85rem; word-break: break-all; margin: 8px 0 16px; white-space: pre-wrap; }
    .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .info-item { background: #fafaf9; border-radius: 8px; padding: 12px; border: 1px solid #e7e5e4; }
    .info-item .label { font-size: 0.75rem; color: #a8a29e; margin-bottom: 2px; }
    .info-item .val { font-size: 0.85rem; color: #1c1917; font-weight: 500; font-family: 'SF Mono', Monaco, monospace; }

    /* Bulk */
    .bulk-toggle { margin-top: 12px; }
    .bulk-box { margin-top: 12px; }
    .bulk-hint { color: #a8a29e; font-size: 0.8rem; margin-top: 4px; }
    .hidden { display: none !important; }

    /* Toast */
    .toast { position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 10px; font-size: 0.9rem; z-index: 1000; animation: slideIn 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .toast-ok { background: #dcfce7; color: #16a34a; }
    .toast-err { background: #fee2e2; color: #dc2626; }
    @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
  </style>
</head>
<body>

<!-- Login -->
<div id="login-view">
  <div class="login-card">
    <div class="logo">&#9889;</div>
    <h1>Zo Gateway</h1>
    <p class="sub">号池管理系统</p>
    <div class="input-group">
      <label>Gateway Key</label>
      <input type="password" id="login-key" placeholder="输入管理密钥" autofocus>
    </div>
    <button class="btn btn-primary btn-block" onclick="login()">登录</button>
  </div>
</div>

<!-- App -->
<div id="app">
  <div class="sidebar">
    <div class="sidebar-logo"><span class="icon">&#9889;</span> Zo Gateway</div>
    <nav class="sidebar-nav">
      <div class="nav-item active" data-page="dashboard"><span class="nav-icon">&#9632;</span> 仪表盘</div>
      <div class="nav-item" data-page="tokens"><span class="nav-icon">&#9883;</span> 号池管理</div>
      <div class="nav-item" data-page="info"><span class="nav-icon">&#8635;</span> 接入信息</div>
    </nav>
    <div class="sidebar-footer">
      <button onclick="logout()">退出登录</button>
    </div>
  </div>

  <div class="main">
    <!-- Dashboard -->
    <div class="page active" id="page-dashboard">
      <div class="page-title">仪表盘</div>
      <div class="stats">
        <div class="stat-card"><div class="label">总计 Token</div><div class="value blue" id="s-total">0</div></div>
        <div class="stat-card"><div class="label">可用</div><div class="value green" id="s-available">0</div></div>
        <div class="stat-card"><div class="label">已禁用</div><div class="value red" id="s-disabled">0</div></div>
        <div class="stat-card"><div class="label">冷却中</div><div class="value amber" id="s-cooldown">0</div></div>
      </div>
      <div class="card">
        <h3>调用日志</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>时间</th><th>模型</th><th>格式</th><th>状态</th><th>耗时</th><th>错误</th></tr></thead>
            <tbody id="log-list"></tbody>
          </table>
          <div id="log-empty" class="empty-state hidden">暂无调用记录</div>
        </div>
      </div>
    </div>

    <!-- Tokens -->
    <div class="page" id="page-tokens">
      <div class="page-title">号池管理</div>
      <div class="card">
        <h3>添加 Token</h3>
        <div class="add-row">
          <div class="input-group"><label>备注名</label><input type="text" id="add-label" placeholder="账号1"></div>
          <div class="input-group"><label>Zo Access Token</label><input type="text" id="add-token" placeholder="zo_sk_..."></div>
          <button class="btn btn-primary" onclick="addToken()">添加</button>
        </div>
        <div class="bulk-toggle">
          <button class="btn btn-outline btn-sm" onclick="toggleBulk()">批量导入</button>
        </div>
        <div id="bulk-box" class="bulk-box hidden">
          <textarea id="bulk-tokens" placeholder="每行一个 Token：&#10;zo_sk_token1&#10;备注名:zo_sk_token2"></textarea>
          <p class="bulk-hint">格式：每行一个，可选 "备注名:token"</p>
          <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="bulkAdd()">批量添加</button>
        </div>
      </div>
      <div class="card">
        <h3>Token 列表</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>备注</th><th>Token</th><th>添加时间</th><th>状态</th><th>操作</th></tr></thead>
            <tbody id="token-list"></tbody>
          </table>
          <div id="list-empty" class="empty-state hidden">还没有 Token</div>
        </div>
      </div>
    </div>

    <!-- Info -->
    <div class="page" id="page-info">
      <div class="page-title">接入信息</div>
      <div class="card">
        <h3>API 端点</h3>
        <div class="info-grid">
          <div class="info-item"><div class="label">Base URL</div><div class="val">${baseUrl}</div></div>
          <div class="info-item"><div class="label">Anthropic 兼容</div><div class="val">/v1/messages</div></div>
          <div class="info-item"><div class="label">OpenAI 兼容</div><div class="val">/v1/chat/completions</div></div>
          <div class="info-item"><div class="label">模型列表</div><div class="val">/v1/models</div></div>
        </div>
      </div>
      <div class="card">
        <h3>支持的模型</h3>
        <div class="info-grid">
          <div class="info-item"><div class="label">Anthropic</div><div class="val">claude-opus-4-7</div></div>
          <div class="info-item"><div class="label">Anthropic</div><div class="val">claude-sonnet-4-6</div></div>
          <div class="info-item"><div class="label">OpenAI</div><div class="val">gpt-5.3-codex</div></div>
          <div class="info-item"><div class="label">OpenAI</div><div class="val">gpt-5.4 / gpt-5.5</div></div>
          <div class="info-item"><div class="label">OpenAI</div><div class="val">gpt-5.4-mini</div></div>
          <div class="info-item"><div class="label">DeepSeek</div><div class="val">deepseek-v4-pro</div></div>
          <div class="info-item"><div class="label">Z.AI</div><div class="val">glm-5</div></div>
          <div class="info-item"><div class="label">Minimax</div><div class="val">minimax-m2.5 / m2.7</div></div>
          <div class="info-item"><div class="label">Google</div><div class="val">gemini-3.1-pro-preview</div></div>
        </div>
      </div>
      <div class="card">
        <h3>OpenAI 格式 (通用)</h3>
        <div class="code-box">curl -s ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\
  -d '{
    "model": "zo:openai/gpt-5.4",
    "messages": [{"role":"user","content":"你好"}]
  }'</div>
      </div>
      <div class="card">
        <h3>Anthropic 格式</h3>
        <div class="code-box">curl -s ${baseUrl}/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role":"user","content":"你好"}]
  }'</div>
      </div>
      <div class="card">
        <h3>Claude Code 配置</h3>
        <div class="code-box">export ANTHROPIC_BASE_URL=${baseUrl}
export ANTHROPIC_API_KEY=你的GatewayKey

claude</div>
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

function mask(t) {
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
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    loadDashboard();
  } catch (e) { toast('密钥错误', false); }
}

function logout() {
  authKey = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('login-key').value = '';
}

document.getElementById('login-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('page-' + item.dataset.page).classList.add('active');
    if (item.dataset.page === 'dashboard') loadDashboard();
    if (item.dataset.page === 'tokens') loadTokens();
  });
});

async function loadDashboard() {
  try {
    const [tokenData, logData] = await Promise.all([
      api('GET', '/admin/tokens'),
      api('GET', '/admin/logs'),
    ]);
    renderStats(tokenData.tokens, tokenData.pool_status);
    renderLogs(logData.logs);
  } catch (e) { toast('加载失败：' + e.message, false); }
}

async function loadTokens() {
  try {
    const data = await api('GET', '/admin/tokens');
    renderTokenList(data.tokens);
  } catch (e) { toast('加载失败：' + e.message, false); }
}

function renderStats(tokens, pool) {
  const enabled = tokens.filter(t => t.enabled).length;
  const disabled = tokens.length - enabled;
  const cooldown = pool.total - pool.available;
  document.getElementById('s-total').textContent = tokens.length;
  document.getElementById('s-available').textContent = pool.available;
  document.getElementById('s-disabled').textContent = disabled;
  document.getElementById('s-cooldown').textContent = cooldown > 0 ? cooldown : 0;
}

function renderLogs(logs) {
  const tbody = document.getElementById('log-list');
  const empty = document.getElementById('log-empty');
  if (!logs || logs.length === 0) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  const sorted = logs.slice().reverse();
  tbody.innerHTML = sorted.map(l => {
    const time = new Date(l.time).toLocaleString('zh-CN', { hour12: false });
    const fmtBadge = l.format === 'openai'
      ? '<span class="badge badge-openai">OpenAI</span>'
      : '<span class="badge badge-anthropic">Anthropic</span>';
    const stBadge = l.status === 'ok'
      ? '<span class="badge badge-ok">成功</span>'
      : '<span class="badge badge-err">失败</span>';
    const dur = l.duration < 1000 ? l.duration + 'ms' : (l.duration / 1000).toFixed(1) + 's';
    const err = l.error ? '<span style="color:#dc2626;font-size:0.8rem">' + l.error.slice(0, 60) + '</span>' : '-';
    return \`<tr><td style="color:#a8a29e;white-space:nowrap">\${time}</td><td class="token-mono">\${l.model}</td><td>\${fmtBadge}</td><td>\${stBadge}</td><td>\${dur}</td><td>\${err}</td></tr>\`;
  }).join('');
}

function renderTokenList(tokens) {
  const tbody = document.getElementById('token-list');
  const empty = document.getElementById('list-empty');
  if (tokens.length === 0) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  tbody.innerHTML = tokens.map(t => {
    const st = t.enabled ? '<span class="badge badge-on">启用</span>' : '<span class="badge badge-off">禁用</span>';
    const tBtn = t.enabled
      ? \`<button class="btn btn-outline btn-sm" onclick="toggleTk('\${t.token}',false)">禁用</button>\`
      : \`<button class="btn btn-success btn-sm" onclick="toggleTk('\${t.token}',true)">启用</button>\`;
    return \`<tr>
      <td>\${t.label}</td>
      <td class="token-mono">\${mask(t.token)}</td>
      <td style="color:#a8a29e">\${new Date(t.addedAt).toLocaleDateString('zh-CN')}</td>
      <td>\${st}</td>
      <td><div class="actions-cell">\${tBtn}<button class="btn btn-danger btn-sm" onclick="removeTk('\${t.token}')">删除</button></div></td>
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

function toggleBulk() { document.getElementById('bulk-box').classList.toggle('hidden'); }

async function bulkAdd() {
  const raw = document.getElementById('bulk-tokens').value.trim();
  if (!raw) return toast('请输入 Token', false);
  const lines = raw.split('\\n').map(l => l.trim()).filter(Boolean);
  let ok = 0, fail = 0;
  for (const line of lines) {
    let label = '', token = '';
    if (line.includes(':')) { const i = line.indexOf(':'); label = line.slice(0, i).trim(); token = line.slice(i+1).trim(); }
    else { token = line; label = 'Token-' + (ok + 1); }
    try { await api('POST', '/admin/tokens', { token, label }); ok++; } catch { fail++; }
  }
  document.getElementById('bulk-tokens').value = '';
  toast(\`导入完成：\${ok} 成功\${fail > 0 ? '，' + fail + ' 失败' : ''}\`);
  loadTokens();
}

async function removeTk(token) {
  if (!confirm('确定删除？')) return;
  try { await api('DELETE', '/admin/tokens', { token }); toast('已删除'); loadTokens(); }
  catch (e) { toast(e.message, false); }
}

async function toggleTk(token, enabled) {
  try { await api('PATCH', '/admin/tokens', { token, enabled }); toast(enabled ? '已启用' : '已禁用'); loadTokens(); }
  catch (e) { toast(e.message, false); }
}
</script>
</body>
</html>`;
}
