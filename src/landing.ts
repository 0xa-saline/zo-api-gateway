export function getLandingHTML(
  baseUrl: string,
  multiKeyMode: boolean = false,
  poolStatus: { total: number; available: number } | null = null,
): string {
  const modeLabel = multiKeyMode ? '多 Key 聚合模式' : '直通模式';
  const modeDesc = multiKeyMode
    ? '已配置多个 Zo Token，使用统一的 Gateway Key 访问。网关自动轮询和故障切换。'
    : '使用你自己的 Zo Access Token 直接访问。';
  const authNote = multiKeyMode
    ? 'API Key 填写管理员配置的 <strong>Gateway Key</strong>（不是 Zo Token）。'
    : 'API Key 填写你的 <strong>Zo Access Token</strong> 即可。';
  const curlToken = multiKeyMode ? 'YOUR_GATEWAY_KEY' : 'YOUR_ZO_TOKEN';

  const poolInfo = poolStatus
    ? `<div class="status-bar">Token 池：${poolStatus.available} / ${poolStatus.total} 可用</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zo Computer API Gateway</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #e0e0e0; line-height: 1.7;
    }
    .container { max-width: 800px; margin: 0 auto; padding: 40px 24px; }
    h1 { font-size: 2rem; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .subtitle { color: #888; font-size: 1.1rem; margin-bottom: 40px; }
    h2 { font-size: 1.3rem; color: #fff; margin: 32px 0 12px; }
    h3 { font-size: 1.1rem; color: #ccc; margin: 20px 0 8px; }
    p { margin-bottom: 16px; color: #aaa; }
    a { color: #7c9eff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      background: #1a1a2e; color: #7c9eff; padding: 2px 6px; border-radius: 4px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 0.9em;
    }
    pre {
      background: #111; border: 1px solid #222; border-radius: 8px;
      padding: 16px; overflow-x: auto; margin: 12px 0 20px;
    }
    pre code { background: none; padding: 0; color: #c9d1d9; }
    .base-url {
      background: #1a1a2e; border: 1px solid #333; border-radius: 8px;
      padding: 16px; margin: 16px 0; font-family: monospace; font-size: 1.1rem;
      color: #7c9eff; word-break: break-all;
    }
    .steps { counter-reset: step; list-style: none; padding: 0; }
    .steps li {
      counter-increment: step; position: relative; padding-left: 48px;
      margin-bottom: 24px;
    }
    .steps li::before {
      content: counter(step);
      position: absolute; left: 0; top: 0;
      width: 32px; height: 32px; border-radius: 50%;
      background: #1a1a2e; border: 1px solid #333;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; color: #7c9eff; font-size: 0.9rem;
    }
    .card {
      background: #111; border: 1px solid #222; border-radius: 12px;
      padding: 24px; margin: 16px 0;
    }
    .badge {
      display: inline-block; padding: 4px 12px; border-radius: 20px;
      font-size: 0.8rem; font-weight: 600; margin-left: 12px;
    }
    .badge-multi { background: #1a3a2e; color: #4ade80; border: 1px solid #2d6a4f; }
    .badge-direct { background: #1a1a3e; color: #7c9eff; border: 1px solid #333; }
    .status-bar {
      background: #1a2a1e; border: 1px solid #2d6a4f; border-radius: 8px;
      padding: 12px 16px; margin: 12px 0; color: #4ade80; font-family: monospace;
    }
    .footer { text-align: center; color: #555; margin-top: 60px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Zo Computer API Gateway
      <span class="badge ${multiKeyMode ? 'badge-multi' : 'badge-direct'}">${modeLabel}</span>
    </h1>
    <p class="subtitle">Anthropic Messages API 兼容网关 — ${modeDesc}</p>

    <div class="card">
      <p>这个网关提供兼容 <code>/v1/messages</code> 的接口。${modeDesc}</p>
      <div class="base-url">${baseUrl}</div>
      ${poolInfo}
    </div>

    <h2>快速开始</h2>
    <ol class="steps">
      ${multiKeyMode ? `
      <li>
        <h3>获取 Gateway Key</h3>
        <p>向管理员获取统一的 Gateway Key。</p>
      </li>` : `
      <li>
        <h3>注册 Zo Computer</h3>
        <p>访问 <a href="https://zo.computer" target="_blank">zo.computer</a> 完成注册。</p>
      </li>
      <li>
        <h3>获取 Access Token</h3>
        <p>登录后进入 <strong>设置 → 高级 → Access Tokens</strong>，创建并复制你的 API Key。</p>
      </li>`}
      <li>
        <h3>调用网关</h3>
        <p>把 Key 放进 <code>Authorization: Bearer</code> 或 <code>x-api-key</code> 请求头，目标地址使用上面的 Base URL。</p>
      </li>
    </ol>

    <h2>调用示例</h2>
    <pre><code>curl -s ${baseUrl}/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${curlToken}" \\
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "你好"}
    ],
    "stream": false
  }'</code></pre>

    <h2>支持的功能</h2>
    <div class="card">
      <p><strong>模型路由</strong> — 支持所有 Zo Computer 上可用的 Anthropic 模型，如 <code>claude-opus-4-7</code>、<code>claude-sonnet-4</code> 等。</p>
      <p><strong>流式输出</strong> — 支持 <code>"stream": true</code>，返回 SSE 格式流，兼容 Anthropic SDK。</p>
      <p><strong>双认证</strong> — 支持 <code>Authorization: Bearer</code> 和 <code>x-api-key</code> 两种认证方式。</p>
      <p><strong>系统提示</strong> — 支持 <code>system</code> 字段传入系统提示词。</p>
      ${multiKeyMode ? `<p><strong>多 Key 聚合</strong> — 多个 Zo Token 轮询调度，自动跳过失败/限速的 Token，对外统一为一个 Key。</p>` : ''}
    </div>

    <h2>客户端配置</h2>
    <div class="card">
      <p>在支持自定义 Base URL 的客户端（Claude Code、Cursor 等）中，将 Base URL 设置为：</p>
      <div class="base-url">${baseUrl}</div>
      <p>${authNote}</p>
    </div>

    ${multiKeyMode ? `
    <div class="card" style="text-align:center">
      <p><a href="${baseUrl}/admin" style="color:#7c9eff;font-weight:600;font-size:1.1rem;">进入号池管理面板 →</a></p>
      <p style="color:#666;font-size:0.85rem;">管理员可在面板中添加/删除/启停 Zo Token</p>
    </div>` : ''}

    <div class="footer">
      Zo Computer API Gateway · Powered by Cloudflare Workers
    </div>
  </div>
</body>
</html>`;
}
