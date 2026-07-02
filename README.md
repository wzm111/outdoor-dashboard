# 户外助手看板（Web / PWA）

一个**纯静态、零构建步骤**的单页看板，直接读取你的 Supabase 数据，展示活动、装备、路线、身体趋势和计划。可作为 PWA 安装到手机/桌面，支持离线查看上次同步的快照。

## 它是什么

- 纯 vanilla JS + 一个 `<canvas>` 画折线，**无第三方库、无打包工具**，呼应本项目脚本侧 stdlib-only 的风格。
- 通过现有 Edge Function API 工作：
  1. 用 `api_secret` 调 `POST /api/auth/token` 换取 JWT；
  2. 用 JWT 调 `POST /api/sync {action:"export"}` 一次性拉全量数据；
  3. 客户端解包（对齐脚本侧 `_unwrap`）并渲染。

## 🔒 安全说明（重要）

- **密钥绝不写入代码仓库。** 仓库里的 `app.js` 只有一个默认 *API 地址*（非敏感），没有任何密钥。
- 访问密钥（`api_secret`）由你在浏览器界面输入，勾选「记住」后**仅存本浏览器的 `localStorage`**，不上传、不进 git。
- 点右上角 ⏏（断开）或清除浏览器站点数据即可移除密钥与本地快照。
- Service Worker **不缓存任何 API 响应**（含 token 和数据），只缓存静态外壳；离线数据回退用的是 `localStorage` 快照，由页面逻辑控制。
- 如果你把看板部署到**公开** URL：任何拿到该 URL 的人看到的只是登录框，没有密钥进不去；但请勿在公共电脑上勾选「记住密钥」。

## 本地运行

因为用了 Service Worker 和 `fetch`，建议用本地 HTTP 服务（直接 `file://` 打开时 SW 不可用，但核心功能仍可用）：

```bash
cd web
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

首屏填入：

- **API 地址**：`https://<你的项目>.supabase.co/functions/v1`（已预填默认值）
- **访问密钥**：你的 `api_secret`（与 `~/.outdoor-assistant/config.json` 里的一致）

点「连接」即可。

## 部署到 GitHub Pages（已上线）

本目录的前端**已部署**到独立公开仓库，线上地址：

**<https://wzm111.github.io/outdoor-dashboard/>**

部署架构（因主仓库 `outdoor-assistant` 为私有、免费账号私有仓库无法开 Pages）：

- 源码维护在**本私有主仓库**的 `web/` 目录（唯一正确源）。
- 一个独立**公开仓库** `wzm111/outdoor-dashboard` 仅托管前端 6 文件（无任何密钥），开 GitHub Pages（main 分支 / 根目录）。
- 改完本目录代码后，运行同步脚本把改动推到公开仓库、触发 Pages 重建：

```bash
bash web/sync-to-pages.sh            # 同步并推送
bash web/sync-to-pages.sh --dry-run  # 只看会同步什么，不推送
```

脚本会自动 clone 公开仓库、覆盖前端文件、**推送前扫描密钥**、仅在有改动时提交推送（带网络重试），跑完清理临时目录。前置：`gh` CLI 已登录（走 HTTPS token，无需 SSH）。

> Edge Function 已设 `Access-Control-Allow-Origin: *`，跨域无需额外配置。

## 应用图标

`manifest.json` 引用 `icon-192.png` / `icon-512.png` 作为 PWA 安装图标，仓库已附带（深墨绿圆角底 + 翠绿雪山峰，与页面主色一致）。它们由 `web/` 下用 Python 标准库（`zlib`+`struct` 手写最小 PNG 编码器）生成，无需 ImageMagick/PIL。

要换图标，放两张对应尺寸的方形 PNG 覆盖即可（有 ImageMagick 时 `magick source.png -resize 192x192 web/icon-192.png`），然后跑同步脚本。

> ⚠️ **改任何前端文件后，记得 bump `service-worker.js` 顶部的 `CACHE` 版本号**（如 `outdoor-dashboard-v2` → `v3`）。否则旧版外壳会一直从 Service Worker 缓存返回，用户看到的还是旧页面（缓存清理逻辑只删“非当前版本”的缓存，不会清掉同名缓存自身）。

## 视图说明

| 标签 | 内容 |
|------|------|
| 总览 | 关键统计卡片（总活动/里程/爬升/时长/近 30 天里程/装备数）+ 体能档案 + 最近 5 次活动 |
| 活动 | 全部活动表格（日期、路线、距离、爬升、时长、心率、感受），支持手动新增/编辑/删除 + AI 一句话录入 |
| 身体趋势 | 体重 / 疲劳度 / 睡眠 / 肌肉酸痛 的折线图；支持手动新增/编辑/删除 + AI 一句话录入 |
| 装备 | 装备按类别分组卡片，支持展开详情、新增/编辑/删除、从网页抓取/粘贴规格/AI 识别参数更新装备 |
| 路线 | 路线库表格（按距离降序），支持查看详情、新增/编辑/删除 + AI 一句话录入 |
| 计划 | 行程计划 + 恢复计划卡片，支持手动新增/编辑/删除、由路线一键生成装备推荐；**支持按天数自动调整装备与消耗品，自动天气失败可手动兜底** |

## 装备更新

装备卡片上两个按钮：

- **详情**：展开装备全部字段（重量、材质、防水、价格、尺码、季节、地形等）。
- **更新**：通过三种方式补全/更新装备信息：
  1. **网页抓取**：填写 REI / 品牌官网商品 URL，由后端 Edge Function 代理抓取重量、材质、防水、价格、颜色尺码等字段。
  2. **AI 识别**：用自然语言描述装备（或粘贴规格文本），后端同时调用 Kimi（Moonshot）和 DeepSeek 自动提取结构化字段，取结果更完整的一方。
  3. **粘贴规格文本**：从京东/天猫商品详情页复制规格参数文本，前端自动解析重量、材质、防水、价格、颜色尺码、季节、地形等字段。

网页抓取和 AI 识别需要先在 Supabase 部署 `/api/scrape/gear` 与 `/api/ai/gear` 端点，参考 `web/scrape-gear-edge-function.ts` 与 `supabase/functions/api/index.ts`。部署前需在 Supabase 环境变量中配置 `MOONSHOT_API_KEY` 和 `DEEPSEEK_API_KEY`。

京东/天猫反爬较强，若抓取失败请优先使用 AI 识别或粘贴规格文本方式。

## 数据契约

看板消费 `POST /api/sync {action:"export"}` 的返回：

```json
{
  "profile": { "data": {...}, "raw_markdown": "..." },
  "gear":     [{ "slug": "...", "data": {...}, "raw_markdown": "..." }],
  "routes":   [{ "slug": "...", "name": "...", "data": {...} }],
  "activities":[{ "date": "...", "route": "...", "data": {...} }],
  "body_logs":[{ "date": "...", "data": {...} }],
  "plans":    [{ "plan_type": "...", "date": "...", "route": "...", "data": {...} }],
  "segments": [{ "slug": "...", "data": {...} }]
}
```

注意：export 返回的是**未解包**的 DB 行（`{slug/date, data, ...}`），看板用 `unwrap()` 在客户端展开成扁平字段，逻辑与脚本侧 `APIBackend._unwrap` 一致。
