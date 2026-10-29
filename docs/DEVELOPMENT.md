# 开发说明

项目使用 Vue 3 + TypeScript + Vite，Node.js 24 + Express 提供同源本地服务。依赖版本由 `package-lock.json` 固定。

V2 视觉、主题/浏览偏好与验收说明见 [V2.md](V2.md)。主视觉由 `SceneBackdrop.vue` 和 `scene-visual.css` 绘制，不需要单独准备背景图片；已弃用的图片处理脚本仅在本机 `.local/` 归档。日常启动直接使用已构建产物。

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/` | Vue 页面、组件与浏览器状态 |
| `shared/` | 前后端共用类型、排期与简介拆分逻辑 |
| `server/` | 本地 API、上游请求、数据标准化与缓存 |
| `data/` | 带来源链接的人工排期修正 |
| `public/` | 图标与缺图占位资源 |
| `tests/` | 单元、接口、浏览器测试及固定样本 |
| `docs/` | 使用补充、来源核查与当前截图 |
| `.local/` | 仅保存在本机的缓存、临时日志与开发归档，不提交 Git |

## 安装与运行

在项目根目录运行 `npm ci`、`npm run build`，然后双击 `start.cmd`，访问 `http://127.0.0.1:4317`。浏览器测试需要安装在本机的 Google Chrome。

开发页面使用 `npm run dev`，API 转发到 4317，本地服务需同时运行。服务端 TypeScript 需通过 `npm run build` 重新编译，修改后关闭旧启动窗口再重新启动。当前版本是本机工具，监听地址固定为 127.0.0.1。

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

测试与实际缓存隔离，浏览器测试服务使用 4321。上游联网验证与固定样本自动测试分别记录，不能用测试通过代替源数据准确性核查。

开发时的临时日志统一放在 **`.local/dev-logs/`**，不写入项目根目录。若目录尚不存在，可先创建，再按需重定向命令输出。测试报告保留在工具默认的 `test-results/` 等目录，均不提交。

## 数据维护

基础目录来自 bangumi-data；详情、制作和角色资料来自 Bangumi。启动时缓存超过六小时才自动刷新，页内可手动刷新；详情及角色中文名缓存24小时。网络先行识别包含通用逻辑与人工核实修正，不能保证每季度全部资料都自动准确。

人工规则位于 `data/overrides.json`，修改后重启服务。新增修正应附一手来源，避免将页面建档、旧季记录或首集特别播出作为整季周期。已核查依据见 [数据来源核查](data-validation.md)。

收藏保存在浏览器当前 origin 的 localStorage，迁移前使用页面的 JSON 导出功能。`.local/` 不是收藏数据库，也不应作为可分发的数据包提交。

## Git

仓库地址：<https://github.com/KONOK-A/Anime-Calendar>。`main` 保存可用版本，功能开发默认使用 `codex/` 前缀分支。

提交包含源码、锁文件、测试、文档和必要静态资源；依赖、构建产物、缓存、临时日志、环境文件及测试报告由 `.gitignore` 排除。代码沿用仓库已有的 MIT License；第三方数据的署名见 [README](../README.md#来源)。
