# 面霸 机器人须知

先读 README.md。自用 Web 应用，原生 JS + 零依赖 Node 服务端。

- 不引入 npm 依赖、不加构建步骤；前端第三方库只允许按需从 CDN 动态 import（参考 pdf.js 的用法）
- 前端拼 HTML 时，所有用户数据和 AI 返回内容都必须经过 `esc()`
- CI 只做语法检查：`node --check server.js && node --check public/app.js && node --check jobwatch/watcher.js && node --check jobwatch/store.js`
- 绝不提交任何 key，`data/` 下是用户数据
- 一个 issue 只改一件事，改动尽量小；需求不清就在 issue 里提问，别猜
- `jobwatch/` 是独立的岗位巡检程序，有自己的 `package.json`（patchright），上面「不引入 npm 依赖」只针对面霸本身；它的运行数据（config.json、profile/、jobs.db 等）只在服务器上，不进仓库
