# 番时记 · 日本新番日历

查看季度新番、每周放送安排和管理追番的本机网页工具。支持浅深主题，适配桌面和手机。

## 功能

- **本周番表**：竖列、横排切换，支持北京时间与日本时间。
- **季度目录**：标题与别名搜索、类型筛选、卡片密度切换。
- **作品详情**：评分、简介、制作阵容、角色 CV 和播放平台链接。
- **我的追番**：收藏片单、查看下次放送、导入与导出 JSON 备份。

## 启动

需要 Windows、Node.js 24.19+（24 系列）和 npm。

```powershell
git clone https://github.com/KONOK-A/Anime-Calendar.git
cd Anime-Calendar
npm ci
npm run build
.\start.cmd
```

以后双击 `start.cmd` 即可打开 http://127.0.0.1:4317。关闭启动窗口或按 Ctrl+C 停止服务。

收藏保存在当前浏览器中。更新源码后，重新构建并启动。

## 数据与许可

排期优先采用网络先行时间，仅供参考；实际放送和地区限制以官方为准。

目录来自 [bangumi-data](https://github.com/bangumi-data/bangumi-data)（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)），经过筛选与修正；作品资料来自 [Bangumi API](https://github.com/bangumi/api)。

使用 Vue 3、TypeScript、Vite 和 Express。代码采用 [MIT](LICENSE)，霞鹜文楷字体遵循 [OFL](public/fonts/OFL-LXGWWenKai.txt)。
