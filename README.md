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
- GitHub Actions 自动部署，push 到 main 即自动更新
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

## 部署（GitHub Actions 自动部署）

只需要配置一次，之后每次 push 到 main 分支都会自动部署。

### 第 1 步：Fork 本仓库

点击 GitHub 页面右上角的 **Fork** 按钮，把仓库复制到你自己的账号下。

### 第 2 步：获取 Cloudflare API Token

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击右上角头像 → **我的个人资料** → 左侧 **API 令牌**
3. 点击 **创建令牌**
4. 选择 **编辑 Cloudflare Workers** 模板
5. 确认权限后点击 **继续摘要** → **创建令牌**
6. 复制生成的令牌（只显示一次）

### 第 3 步：获取 Cloudflare Account ID

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击左侧 **Workers 和 Pages**
3. 右侧会显示 **账户 ID**，复制它

### 第 4 步：配置 GitHub Secrets

进入你 Fork 的仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，依次添加：

| Secret 名称 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 第 2 步获取的 API 令牌 |
| `CLOUDFLARE_ACCOUNT_ID` | 第 3 步获取的账户 ID |

### 第 5 步：触发部署

随便改一下代码（比如编辑 README），push 到 main 分支，GitHub Actions 会自动部署。

部署成功后，你的 Worker URL 是：`https://zo-api-gateway.<你的子域>.workers.dev`

在仓库的 **Actions** 页面可以看到部署状态和日志。

## 管理 Zo Token（部署后动态添加/修改）

Token 通过 Cloudflare Dashboard 管理，**随时可以添加新 Token，不需要改代码或重新部署**。

### 在 Cloudflare Dashboard 管理

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧 **Workers 和 Pages** → 点击 `zo-api-gateway`
3. 点击 **设置** → **变量和机密**
4. 在 **环境变量** 区域添加或编辑以下变量：

| 变量名 | 类型 | 值 | 说明 |
|---|---|---|---|
| `GATEWAY_KEY` | 加密 | `sk-my-gateway-key` | 你自定义的统一 Key，客户端使用这个 |
| `ZO_TOKENS` | 加密 | `zo_sk_token1,zo_sk_token2,zo_sk_token3` | 多个 Zo Token，逗号分隔 |
| `COOLDOWN_MS` | 文本 | `60000` | （可选）Token 失败冷却时间，默认 60 秒 |

5. 点击 **加密** 保存（敏感信息建议选加密类型）
6. 保存后立即生效，无需重新部署

### 后续新增 Token

当你有新的 Zo 账号和 Token 时：

1. 进入 Cloudflare Dashboard → Workers → `zo-api-gateway` → 设置 → 变量和机密
2. 编辑 `ZO_TOKENS`，在末尾加上新 Token（逗号分隔）：`zo_sk_token1,zo_sk_token2,zo_sk_新token`
3. 保存，立即生效

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
