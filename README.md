# Zo Computer API Gateway

一个基于 Cloudflare Workers 的 API 网关，将 Zo Computer 的 API 转换为兼容 Anthropic Messages API (`/v1/messages`) 的接口。

## 功能

- 兼容 Anthropic Messages API `/v1/messages` 端点
- 支持流式 (SSE) 和非流式响应
- 支持 `Authorization: Bearer` 和 `x-api-key` 双认证
- 支持 `system` 系统提示词
- 支持所有 Zo Computer 上可用的 Anthropic 模型
- **多 Key 聚合**：多个 Zo Token 轮询调度，自动故障切换，对外统一为一个 Key
- 自带引导页面，展示 Base URL 和使用说明
- 零成本部署在 Cloudflare Workers 上

## 两种工作模式

### 直通模式（默认）

用户直接传入自己的 Zo Access Token，网关原样转发。

### 多 Key 聚合模式

配置多个 Zo Token + 一个统一的 Gateway Key。客户端只需要用这一个 Gateway Key，网关自动轮询选择后端 Token，并在 Token 失败（429 限速 / 401 失效）时自动切换到下一个。

```
客户端 → Gateway Key → Worker → 轮询选择 Zo Token → api.zo.computer
                                    ↓ 失败时自动切换
                               下一个 Zo Token → api.zo.computer
```

## 部署

### 1. 安装依赖

```bash
npm install
```

### 2. 配置多 Key 聚合（可选）

通过 Cloudflare Secrets 配置（推荐，不会暴露在代码中）：

```bash
# 设置统一的 Gateway Key（客户端使用这个 Key）
npx wrangler secret put GATEWAY_KEY
# 输入你自定义的密钥，比如: sk-my-gateway-key-xxx

# 设置多个 Zo Token，逗号分隔
npx wrangler secret put ZO_TOKENS
# 输入: zo_sk_token1,zo_sk_token2,zo_sk_token3

# （可选）设置 Token 失败后冷却时间，默认 60000ms
npx wrangler secret put COOLDOWN_MS
# 输入: 60000
```

如果不配置这些变量，网关将以直通模式运行。

### 3. 本地开发

```bash
npm run dev
```

本地开发时可创建 `.dev.vars` 文件配置环境变量：

```
GATEWAY_KEY=sk-my-test-key
ZO_TOKENS=zo_sk_token1,zo_sk_token2
COOLDOWN_MS=60000
```

### 4. 部署到 Cloudflare

```bash
npm run deploy
```

首次部署需要登录 Cloudflare 账号。部署后你会获得一个 `*.workers.dev` 域名作为 Base URL。

### 5. 绑定自定义域名（可选）

在 Cloudflare Dashboard 中为 Worker 添加自定义域名路由。

## 使用

### 直通模式

```bash
curl -s https://YOUR_WORKER_URL/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ZO_TOKEN" \
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

### 多 Key 聚合模式

```bash
curl -s https://YOUR_WORKER_URL/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

### 在 Claude Code 中使用

```bash
# 设置环境变量
export ANTHROPIC_BASE_URL=https://YOUR_WORKER_URL
export ANTHROPIC_API_KEY=YOUR_GATEWAY_KEY

# 启动 Claude Code
claude
```

### Python (Anthropic SDK)

```python
import anthropic

client = anthropic.Anthropic(
    api_key="YOUR_GATEWAY_KEY",
    base_url="https://YOUR_WORKER_URL",
)

message = client.messages.create(
    model="claude-opus-4-7",
    max_tokens=1024,
    messages=[{"role": "user", "content": "你好"}],
)
print(message.content[0].text)
```

## 多 Key 调度策略

- **轮询 (Round Robin)**：请求均匀分配到各个 Token
- **自动故障切换**：Token 返回 401/403/429 时自动标记为失败，切换到下一个
- **冷却恢复**：失败的 Token 在冷却时间（默认 60s）后自动恢复可用
- **全部耗尽保护**：所有 Token 都失败时重置状态，重新尝试

## 支持的模型

网关支持 Zo Computer 上所有可用的 Anthropic 模型，包括：

- `claude-opus-4-7`
- `claude-sonnet-4`
- `claude-haiku-4-5-20251001`

传入的 model 名会自动加上 `anthropic:` 前缀路由到 Zo。

## License

MIT
