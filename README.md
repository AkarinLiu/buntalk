# bunbolt

一个跑在 [Bun](https://bun.sh) + [Hono](https://hono.dev) 上的论坛框架，前端用
Vue 3 + Vite，组件基于 [Reka UI](https://reka-ui.com)，同一套代码可运行在
**SQLite / PostgreSQL / MySQL** 之上。

视觉风格参考 [bun.com](https://bun.com)：近黑画布、暖黄到橙的强调色、终端质感的
代码块与克制的分隔线。

## 功能

- 注册 / 登录（会话为签名 httpOnly Cookie，密码用 `Bun.password` 的 argon2id 哈希）
- 版块（分类）管理与排序
- 发主题、无限层级嵌套回复
- Markdown 编辑器：工具栏、快捷键、实时预览 / 分栏预览（原始 HTML 一律转义）
- 上传：发帖、回复与头像都可上传图片或 PDF，落本地磁盘或任意 S3 兼容对象存储
- 点赞（每人每帖一次，可取消）
- 个人主页：资料编辑、主题与回复计数、发表过的主题
- 管理后台：版块增删改、用户封禁与角色调整、主题置顶 / 锁定 / 删除
- 首个注册的账号自动成为管理员

## Markdown 渲染

帖子正文以原始 Markdown 存储，在浏览器端渲染。渲染器是按「结构性安全」配置的：

- `html: false` —— 正文里的原始 HTML 被转义为文本，输出中的每个标签都由
  markdown-it 自己生成
- 未覆盖 markdown-it 默认的 `validateLink`，因此 `javascript:` / `vbscript:` /
  非图片的 `data:` 链接会被丢弃

正因如此，不需要再引入 DOMPurify 之类的消毒库（那还会把 jsdom 拖进来）。`bun test`
里有针对这些注入载荷的用例 —— 它们断言的是「输出里不存在可执行的标签」，而不是
字符串包含关系，因为被转义的载荷本来就会以文本形式出现。

## 上传与对象存储

发帖、回复与头像都支持上传图片或 PDF。文件写入后返回 `/uploads/<key>`，
**这个路径在所有存储后端下都相同** —— 本地磁盘时由 Hono 直接返回字节，S3 时由 Hono
返回 302 跳转到对象（公开桶给直链，私有桶给预签名 URL）。

这一点正是迁移的关键：帖子正文和头像里存的一直是 `/uploads/<key>`，所以从本地搬到 S3
只是复制文件，用户内容一个字都不用改，带宽则完全交给对象存储。

### 接入 S3

支持 AWS S3、Cloudflare R2、MinIO、Backblaze B2、DigitalOcean Spaces。在 `.env` 里
填好桶和凭证就会自动切换驱动，不需要额外的开关：

```bash
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com   # 非 AWS 才需要
S3_REGION=auto
S3_BUCKET=bunbolt
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
# 桶可公开读取时填；不填则走预签名 URL
S3_PUBLIC_URL=https://cdn.example.com
```

设置了 `S3_ENDPOINT` 时按 path-style 寻址（MinIO 要求这样，R2 也接受）；不填则使用
AWS 的 virtual-host 形式。

### 迁移已有文件到 S3

```bash
bun run migrate:s3
```

脚本遍历 `UPLOAD_DIR`，逐个 PUT 到桶里，并对每个对象再做一次 HEAD 校验 —— 静默的
部分失败会变成几周后莫名其妙的坏图，所以这里宁可失败得响亮。可以重复执行（PUT 幂等），
**不会删除本地文件**；确认无误后自行清理，然后打开 `STORAGE_DRIVER=s3` 重启即可。

只要有一个文件失败，脚本就以非 0 退出，方便放进 CI 或部署流程。

### 上传安全

请求里的 `Content-Type` 和文件名都是不可信的。一个**内容是 HTML** 的文件，如果被标成
`image/png` 并按请求声称的类型回传，就是本站点上的存储型 XSS。因此扩展名与回传的
Content-Type 都取自**文件字节本身**（`src/server/filetype.ts` 的魔数嗅探），只接受
PNG / JPEG / GIF / WebP / AVIF / PDF，并且响应带 `X-Content-Type-Options: nosniff`。

SVG 是刻意排除的：它是合法图片，但能携带脚本，被当作文档打开时浏览器会执行它。

key 由服务端生成（UUID + 服务端选定的扩展名），客户端文件名从不进入路径。

## 快速开始

```bash
bun install
bun run dev
```

打开 http://localhost:5173 。API 跑在 :3000，Vite 会把 `/api` 代理过去。

**默认零配置**：不设置 `DATABASE_URL` 时使用本地 SQLite 文件 `./bunbolt.db`，
表结构在首次启动时自动创建，没有需要手动执行的迁移命令。

注册第一个账号 —— 它会成为管理员。

## 配置

复制 `.env.example` 为 `.env`（Bun 会自动加载）：

```bash
# 三选一
DATABASE_URL=./bunbolt.db
DATABASE_URL=postgres://user:password@localhost:5432/bunbolt
DATABASE_URL=mysql://user:password@localhost:3306/bunbolt

PORT=3000
SESSION_SECRET=…   # 生产环境必填（openssl rand -hex 32）
NODE_ENV=production
```

驱动是按需加载的 —— 用 SQLite 时不会加载 `pg` / `mysql2`。

## 生产部署

```bash
bun run build     # 前端产物输出到 dist/
bun run start     # 同时提供 /api 与 dist/ 静态文件
```

生产环境通过 `.env` 设置（Bun 会自动加载，且不依赖 shell 语法，Windows 上同样有效）：

```bash
NODE_ENV=production
SESSION_SECRET=<openssl rand -hex 32 的输出>
```

`NODE_ENV=production` 时若缺少 `SESSION_SECRET`，服务会直接拒绝启动，而不是悄悄
回退到开发用的默认值。

`bun run start` 会让 Hono 同时提供 `/api` 和 `dist/` 里的静态文件，SPA 路由
回退到 `index.html`，未知的 `/api/*` 仍然返回 JSON 404。

## 项目结构

```
index.ts                 服务入口：建表后 Bun.serve
src/shared/types.ts      数据行契约，db 与 web 共用（无任何依赖）
src/db/ddl.ts            手写的建表语句，每种数据库一份
src/db/schema/*.ts       Drizzle 表定义，按方言分成三个文件
src/db/index.ts          按 DATABASE_URL 选择驱动，导出 db / tables
src/db/repo.ts           全部查询，三种数据库共用同一份实现
src/server/app.ts        Hono 应用：先 /api，再 /uploads，最后静态资源
src/server/routes.ts     全部 API 路由
src/server/auth.ts       会话与权限
src/server/storage.ts    本地 / S3 对象存储
src/server/filetype.ts   魔数嗅探（上传的安全边界）
scripts/migrate-to-s3.ts 本地文件 → 桶 的一次性迁移
src/web/                 Vue 应用（pages/ 为路由页面，components/ 为组件）
src/web/markdown.ts      Markdown 渲染器（安全边界，见下）
test/                    bun test 检查
bunfig.toml              测试预加载，保证测试不碰真实的库与上传目录
```

## API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/register` · `/api/auth/login` · `/api/auth/logout` | 会话 |
| `GET` | `/api/auth/me` | 当前用户 |
| `GET` | `/api/categories` | 版块列表（含主题数） |
| `GET` | `/api/categories/:id/threads` | 版块内主题（`?limit&offset`） |
| `GET` | `/api/threads/:id` | 主题与其全部回复 |
| `POST` | `/api/threads` | 发主题 |
| `POST` | `/api/threads/:id/posts` | 回复 |
| `POST` | `/api/posts/:id/like` | 点赞 / 取消 |
| `DELETE` | `/api/posts/:id` · `/api/threads/:id` | 删除（作者或管理员） |
| `GET` | `/api/users/:username` · `/api/users/:username/threads` | 个人主页 |
| `PATCH` | `/api/users/me` | 编辑资料 |
| `POST` | `/api/uploads` | 上传文件（需登录，multipart 的 `file` 字段） |
| — | `/api/admin/*` | 管理员接口（版块 / 用户 / 主题） |

错误统一为 `{ "error": "…" }`。

## 测试

```bash
bun test
```

覆盖数据库层（建表幂等、增删改查、级联删除、点赞开关）、回复树构建、Markdown 注入
载荷，以及上传路径 —— 包括「内容是 HTML 却声称 image/png 会被拒绝」和路径穿越，
另有一组通过子进程驱动的 S3 分支用例（URL 构造与预签名，不需要真实桶）。

`bunfig.toml` 会预加载 `test/setup.ts`，把数据库指到 `:memory:`、存储指到临时目录，
因此测试不会碰到你的真实数据。

## 已知取舍

- Markdown 代码块没有语法高亮（需要 highlighter 与配套主题）
- Markdown 在浏览器端渲染，所以 markdown-it 会进前端包（gzip 后约 44 KB）
- 上传只接受固定白名单（图片或 PDF），加格式就要在 `filetype.ts` 里加魔数签名
- 上传的文件不会在帖子或账号删除时回收，也没有孤儿文件清理任务
- 迁移脚本不列出桶内已有对象（不解析 S3 的 XML 列表响应），所以重跑是覆盖重传
- 没有站内搜索、通知、@ 提及与审核队列
- 登录、注册与上传都没有限流，公网部署前建议在反向代理层加上
- 用户主页的主题列表按作者过滤，接口上限 50 条
- 没有 `vue-tsc`：`bun run build` 能发现导入与模板错误，但不会校验组件 props
