# Zo Computer API Gateway

一个基于 Cloudflare Workers 的 API 网关，将 Zo Computer 的 API 转换为兼容 Anthropic Messages API (`/v1/messages`) 的接口。

## 功能

- 兼容 Anthropic Messages API `/v1/messages` 端点
- 支持流式 (SSE) 和非流式响应
- 支持 `Authorization: Bearer` 和 `x-api-key` 双认证
- 支持 `system` 系统提示词
- 支持所有 Zo Computer 上可用的 Anthropic 模型
- 自带引导页面，展示 Base URL 和使用说明
- 零成本部署在 Cloudflare Workers 上

## 原理

```
客户端 (Anthropic SDK/curl)
    │
    │  POST /v1/messages (Anthropic 格式)
    ▼
Cloudflare Worker (本项目)
    │
    │  协议转换：messages[] → input string
    │  POST /zo/ask (Zo 格式)
    ▼
Zo Computer API (api.zo.computer)
    │
    │  返回 output / SSE stream
    ▼
Cloudflare Worker
    │
    │  响应转换：Zo 格式 → Anthropic 格式
    ▼
客户端
```

## 部署

### 1. 安装依赖

```bash
npm install
```

### 2. 本地开发

```bash
npm run dev
```

### 3. 部署到 Cloudflare

```bash
npm run deploy
```

首次部署需要登录 Cloudflare 账号。部署后你会获得一个 `*.workers.dev` 域名作为 Base URL。

### 4. 绑定自定义域名（可选）

在 Cloudflare Dashboard 中为 Worker 添加自定义域名路由。

## 使用

### curl 示例

```bash
curl -s https://YOUR_WORKER_URL/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ZO_TOKEN" \
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "你好"}
    ],
    "stream": false
  }'
```

### 流式调用

```bash
curl -s https://YOUR_WORKER_URL/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ZO_TOKEN" \
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "给我讲个故事"}
    ],
    "stream": true
  }'
```

### Python (Anthropic SDK)

```python
import anthropic

client = anthropic.Anthropic(
    api_key="YOUR_ZO_TOKEN",
    base_url="https://YOUR_WORKER_URL",
)

message = client.messages.create(
    model="claude-opus-4-7",
    max_tokens=1024,
    messages=[{"role": "user", "content": "你好"}],
)
print(message.content[0].text)
```

## 支持的模型

网关支持 Zo Computer 上所有可用的 Anthropic 模型，包括：

- `claude-opus-4-7`
- `claude-sonnet-4`
- `claude-haiku-4-5-20251001`

传入的 model 名会自动加上 `anthropic:` 前缀路由到 Zo。

## License

MIT
