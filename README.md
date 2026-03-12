# GitHub 每日 Star 趋势工具

一个独立的网页工具，用来抓取 GitHub `Trending` 的**日榜**项目，并补充展示：

- 今日新增 Star 数
- 仓库简介
- 仓库预览图
- 语言 / Topic / Fork / 最近更新时间
- “这个项目是干啥的”中文说明
- 整卡点击直达项目仓库

当前界面风格参考：`https://shangyankeji.github.io/super-dev/`，采用偏 GitHub 深色 SaaS 产品页的视觉语言。

## 目录

- `server.js`：Node 服务端，负责抓取 Trending 和 GitHub API。
- `public/`：网页界面与 GitHub Pages 静态站点目录。
- `scripts/export-static-data.js`：导出静态 JSON 数据给 GitHub Pages 使用。
- `.github/workflows/github-trending-tool-pages.yml`：GitHub Pages 自动部署工作流。

## 启动

```powershell
cd C:\code\github-trending-daily-tool
npm install
npm start
```

默认地址：

- [http://localhost:3210](http://localhost:3210)

## 可选配置

如果你希望提升 GitHub API 速率限制，可以先设置环境变量：

```powershell
$env:GITHUB_TOKEN="你的 GitHub Token"
npm start
```

## GitHub Pages 部署

已经准备好 GitHub Pages 工作流。推送到远端后，工作流会：

1. 安装依赖
2. 抓取当天 Trending 数据
3. 生成 `public/data/official-top.json`、`public/data/custom-top.json` 和兼容文件 `public/data/trending.json`
4. 把 `public/` 发布到 GitHub Pages

如果当前仓库开启了 GitHub Pages（GitHub Actions 模式），预计在线地址会是：

- `https://summerchaserwwz.github.io/github-trending-daily-tool/`

## 关于“为什么只有 9 个”

在 **2026-03-11** 这次抓取里，GitHub `Trending` 日榜页面本身只返回了 **9 个仓库卡片**，不是前端漏渲染。页面里现在会直接提示这个原因。

## 实现说明

- 通过 `https://github.com/trending?since=daily` 抓取日榜。
- 通过 GitHub REST API 补充仓库元信息。
- 当仓库缺少简介时，会尝试读取 README 首段作为说明。
- 项目预览图使用 GitHub 仓库的 Open Graph 图片。
- Topic 标签改成了马卡龙配色，并支持点击跳转 Topic 页面。
- 服务端做了 10 分钟内存缓存，避免频繁请求 GitHub。
- 顶部导航、Hero、信号条和卡片区采用可复用模板，已同步沉淀到本机技能：`C:\Users\13403\.codex\skills\ui-skill`
