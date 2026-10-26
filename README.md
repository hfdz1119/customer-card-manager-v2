# 白名单售卖管理系统 V2

一套轻量的单管理员客户与销售管理工具，专用于白名单卡片售卖。每个使用者独立部署、独立 D1 和管理员；没有公开注册、团队权限、付费服务器或额外后端。

- 前端：React + TypeScript + Vite + Tailwind CSS。
- 后端：一个 Cloudflare Worker REST API。
- 静态页面：Workers Static Assets 与 Worker 同一次部署（不是 Pages）。
- 数据：一个 Cloudflare D1，SQL migrations 有版本记录。
- 费用：只记录 Cloudflare 账户实际使用所产生的费用；本项目会优先采用轻量结构，但不保证任何使用量都永久免费。

## 功能

- 仪表盘从数据库统计客户总数、有效、7 天内到期、已到期、无到期日客户、已知销售额/利润和待补录售价订单数。
- 客户可以新增、编辑、搜索姓名或联系方式、筛选状态、查看完整购买历史；删除前明确确认，删除客户会通过外键级联删除其全部购买记录。
- 固定卡种成本：月卡 ¥6、季卡 ¥16、年卡 ¥60、白名单 ¥240。每笔订单保存购买时成本快照，修改卡种会按新卡种更新该订单的成本快照；日后修改代码默认成本不会重算旧订单。
- 每位客户可有多笔购买记录。到期日必须手动填入或留空，不按卡种推算；售价可留空，留空订单显示“待补录”，销售额和利润不把它当作零售价。
- 续费新增一笔订单，不覆盖旧记录。利润只按“已知售价 - 购买时成本快照”计算。
- 到期页面列出未来 1–7 天及已到期订单，含联系方式、卡种、日数和客户历史入口；今天到期仍算有效，不计入“即将到期”。 日期统一按 `Asia/Shanghai` 业务时区计算。
- 订单可按姓名/联系方式、卡种和购买日期筛选。客户和订单可分别导出 CSV，使用 UTF-8 BOM、转义双引号并防护以 `= + - @` 开始的表格公式注入。
- 默认深色主题，可切换浅色；窄屏下列表可横向阅读而不会撑宽整个页面。
- 登录失败限制、PBKDF2-SHA256 密码哈希、签名会话、`HttpOnly; Secure; SameSite=Strict` Cookie、同源与 CSRF 校验、受保护 API 的服务端鉴权、参数化 SQL、统一错误信息。无公开密码重置接口。

## 部署：只在自己的电脑运行一条命令

本项目采用 Cloudflare 官方 Workers + Static Assets，不使用 Pages，也不要求在 Cloudflare 网页手工填构建命令、D1 ID 或 Build token。

### 首次部署

需要 Node.js 20+、Corepack 和可登录的 Cloudflare 账号。终端使用你自己的电脑（Windows PowerShell、macOS Terminal 或 Linux shell 均可）；Cloudflare 登录会打开官方授权页面。

1. 在 GitHub Fork 本仓库，或直接 clone：

   ```sh
   git clone https://github.com/<你的GitHub用户名>/customer-card-manager-v2.git
   cd customer-card-manager-v2
   corepack pnpm install
   ```

   Windows 上如果 `corepack` 未启用，可先在 Node.js 安装后运行 `corepack enable`，再安装依赖。

2. 在终端登录 Cloudflare：

   ```sh
   corepack pnpm exec wrangler login
   ```

   如果 Cloudflare 账号有多个账户，登录时选择你希望托管此后台的账户。部署脚本会先显示 Wrangler 当前账户，并在创建资源前要求你确认，避免再次把 D1 建到错误账户。

3. 输入这一条部署命令：

   ```sh
   npm run deploy
   ```

   脚本会依次执行类型检查、测试和生产构建；在当前已确认的 Cloudflare 账户中查找本项目专用数据库 `customer-card-manager-v2-data`，不存在时创建它；生成只保存在本机且已忽略的 Wrangler 配置；应用尚未执行的 migration；第一次部署时在终端隐藏输入两遍管理员密码，生成 PBKDF2-SHA256 哈希，仅把哈希写入系统临时目录中的受限文件，并通过 Wrangler `--secrets-file` 与 Worker 首次发布一起设置为 Secret（文件发布后自动删除）；如果 Secret 已存在则保留，不会重设密码。最后部署 Worker + 静态前端并输出访问网址。

   仅当账号中已存在同名 D1 时，脚本会要求确认后才复用。它不自动拿其他项目的 `customer` 数据库，也不会删除数据库、表或客户资料。迁移失败会停在部署前，不会继续发布。部署需要 Cloudflare 账号的 D1 编辑和 Worker 发布权限；不需要把 API Token 或密码贴进聊天。

4. 打开命令输出的网址，用刚设置的管理员密码登录。先用一条临时测试记录验收新增、编辑、续费、删除和 CSV，再删除测试记录；确认登录和数据库工作后再录入真实客户。

### 如果你之前已经配置过 Cloudflare

- 旧 Workers Builds/GitHub 自动构建不参与这套流程。若同一 Worker 仍连接 GitHub 自动构建，请先在 Cloudflare 的该 Worker 构建设置中关闭/断开自动构建；否则 GitHub 推送仍会启动旧的自动流程。旧流程会被仓库中的安全保护脚本拒绝，不会暗中创建数据库或部署。
- 不要为了重试而删除旧 D1。先备份需要保留的客户数据。此版本会创建/使用独立的 `customer-card-manager-v2-data` D1，不会自动迁移旧 Pages/旧 Worker 数据。
- 之前截图中暴露过的管理员密码应当视为泄露：不要沿用。若保留现有 Cloudflare 环境，删除旧的普通文本 `ADMIN_PASSWORD` 变量并轮换密码；仅使用 Worker Secret。此版本实际读取 `ADMIN_PASSWORD_HASH` Secret。运行 `npm run admin:password:remote` 可用隐藏输入设置新密码哈希；不要把任何密码发给我或提交到 Git。
- 先确认当前 Wrangler 显示的 Cloudflare 账户是目标账户。创建 D1 和部署 Worker 的位置都由本地 `wrangler login` 选择，不受旧 Build token 影响。

### 后续更新

在项目目录拉取新代码，然后重复同一条命令：

```sh
git pull
corepack pnpm install
npm run deploy
```

后续执行会复用本机 `wrangler.deploy.jsonc` 记录的 D1 名称和 ID，校验它仍属于当前 Cloudflare 账户，并只应用新编号的 migration。它不会重新创建/清空数据库，不会修改已执行迁移，也不会把旧订单按新成本重算。请勿手动删除 `wrangler.deploy.jsonc`，除非你已确认 D1 账户/ID 且愿意重新走资源选择流程。

## 备份与恢复

在终端已登录正确 Cloudflare 账号、且成功运行过一次 `npm run deploy` 后：

```sh
npm run db:backup
```

SQL 备份写入项目的 `backups/` 目录（已加入 `.gitignore`）。它包含客户个人资料，视为敏感数据：保存到你自己受控、加密的位置，不要提交 GitHub、发聊天或放在公开网盘。部署前建议先做一次备份。

恢复前先确认备份文件和目标 D1；恢复会写入数据库。建议只恢复到新建的空库，绝不要直接导入当前有真实数据的库。先在终端创建空库：

```sh
corepack pnpm exec wrangler d1 create customer-card-manager-v2-restore
```

再把 `./backups/你的备份文件.sql` 换成实际文件路径，导入到这个新库：

```sh
corepack pnpm exec wrangler d1 execute customer-card-manager-v2-restore --remote --file ./backups/你的备份文件.sql
```

Wrangler 会要求 Cloudflare 登录；确认目标账户后再继续。导入后，先在 Cloudflare D1 控制台核对客户/订单，再切换 Worker。要让 Worker 改用恢复库，打开本机被忽略的 `wrangler.deploy.jsonc`，把 `DB` 项的 `database_name` 和 `database_id` 改成 `customer-card-manager-v2-restore` 和创建时返回的 ID，然后运行 `npm run deploy`；该文件仅留本机，切勿提交。若不熟悉 JSON，先不要切换，保留原 Worker 和 D1，避免误操作。

## 本地开发

复制示例文件，然后用安全的隐藏输入写入本地 `.dev.vars`：

```sh
cp .dev.vars.example .dev.vars
npm run admin:password
npm run dev
```

本地 Wrangler D1 模拟库与 Cloudflare 远程 D1 分开。访问 Vite 显示的本地地址（通常 `http://localhost:5173`）。请勿把 `.dev.vars`、`wrangler.deploy.jsonc`、备份文件或真实客户资料提交到 Git。

## 命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 本地启动 Vite 和 Worker，并使用本地 D1 |
| `npm run build` | TypeScript 检查并构建静态前端 |
| `npm run check` | 类型检查、自动化测试、生产构建 |
| `npm run test` | 运行自动化测试 |
| `npm run deploy` | 当前 Wrangler 账户确认后，检查、创建/复用项目 D1、迁移、设置缺失的管理员 Secret 并发布 |
| `npm run db:create` | 只生成部署用的本地配置并创建/确认项目 D1，不部署 |
| `npm run db:migrate` | 运行检查并应用尚未执行的远程迁移，不部署 |
| `npm run db:migrate:local` | 只应用本地模拟 D1 迁移 |
| `npm run db:backup` | 导出远程 D1 SQL 到本地 `backups/` |
| `npm run admin:password` | 隐藏输入并设置本地管理员密码哈希 |
| `npm run admin:password:remote` | 隐藏输入并更新 Cloudflare `ADMIN_PASSWORD_HASH` Secret |

所有密码至少 16 位；建议用密码管理器生成仅用于此后台的随机密码。迁移脚本只做新增建表和索引，不包含 DROP/DELETE 或示例客户数据。Cloudflare 计划与用量可能变化，具体额度请以你的账户当前页面为准。

## 开发检查

```sh
corepack pnpm install
npm run check
```
