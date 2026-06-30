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

## 部署到 GitHub Pages

本仓库即为「只放前端」的独立公开仓库（前端无任何密钥，密钥仅存用户浏览器 localStorage）。所有文件在仓库**根目录**。

1. 仓库 Settings → Pages：
   - Source 选 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)`。
2. 等待约 1 分钟，访问 `https://wzm111.github.io/outdoor-dashboard/`。
3. Edge Function 已设 `Access-Control-Allow-Origin: *`，跨域请求无需额外配置。

> 源码维护在私有主仓库 `outdoor-assistant` 的 `web/` 目录；本公开仓库仅用于 Pages 托管，更新时从主仓库同步 `web/` 内容过来即可。

## 应用图标（可选）

`manifest.json` 引用了 `icon-192.png` 和 `icon-512.png` 用于 PWA 安装图标。**没有它们应用照常运行**（标签页用内联 SVG ⛰️ 图标）。如需更规范的安装图标，放两张对应尺寸的 PNG 到 `web/` 即可，例如用 ImageMagick：

```bash
# 任意一张方形图片生成两个尺寸
magick source.png -resize 192x192 web/icon-192.png
magick source.png -resize 512x512 web/icon-512.png
```

## 视图说明

| 标签 | 内容 |
|------|------|
| 总览 | 关键统计卡片（总活动/里程/爬升/时长/近 30 天里程/装备数）+ 体能档案 + 最近 5 次活动 |
| 活动 | 全部活动表格（日期、路线、距离、爬升、时长、心率、感受） |
| 身体趋势 | 体重 / 疲劳度 / 睡眠 / 肌肉酸痛 的折线图（canvas 绘制） |
| 装备 | 装备库表格（名称、类别、品牌、重量、防水、使用次数、状态） |
| 路线 | 路线库表格（按距离降序） |
| 计划 | 行程计划 + 恢复计划卡片 |

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
