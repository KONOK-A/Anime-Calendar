# 番时记 · 日本新番日历

日本新番日历网站，查看季度新番、每周放送安排和管理追番收藏。支持浅深主题，适配桌面和手机。

在线访问：[番时记](https://anime.starisle.cc)

## 功能

- **本周番表**：网络配信排期、竖列与横排切换，支持北京时间与日本时间。
- **季度目录**：标题与别名搜索、类型筛选、综合评分排序、卡片密度切换。
- **作品详情**：多来源评分、简介、制作阵容、角色 CV 和播放平台链接。
- **我的追番**：收藏片单、查看下次放送、导入与导出 JSON 备份。

收藏保存在当前浏览器中，不跨设备同步，支持导入、导出 JSON 备份。

## 本地运行

先安装 Node.js 24.19+（24 系列，含 npm）。下载并解压源码，在包含 `package.json` 的项目目录打开终端，依次执行：

```sh
npm ci
npm run build
npm start
```

启动后访问 http://127.0.0.1:4317，终端按 `Ctrl+C` 停止服务。首次启动需联网获取番剧数据。

Windows 完成首次安装与构建后，后续可直接双击项目中的 `start.cmd` 启动。

## 数据与许可

排期采用已收录的常规网络配信时间，缺少可信时刻时列为待定；实际更新和地区限制以官方为准。

目录来自 [bangumi-data](https://github.com/bangumi-data/bangumi-data)（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)），经过筛选与修正；作品资料来自 [Bangumi API](https://github.com/bangumi/api)。

综合评分按可用来源换算为10分制后等权平均；详情保留各站分数与人数。外部数据的使用遵循相应来源规则。

使用 Vue 3、TypeScript、Vite 和 Express。代码采用 [MIT](LICENSE)，霞鹜文楷字体遵循 [OFL](public/fonts/OFL-LXGWWenKai.txt)。
