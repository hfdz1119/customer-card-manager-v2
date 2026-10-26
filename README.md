# 白名单售卖管理系统 V2

一套轻量的单管理员客户与销售管理工具，专用于白名单卡片售卖。每个使用者独立部署、独立 D1 和管理员；没有公开注册、团队权限、付费服务器或额外后端。

- 前端：React + TypeScript + Vite + Tailwind CSS。
- 后端：一个 Cloudflare Worker REST API。
- 页面：Workers Static Assets，与 Worker 同一次部署；不是 Pages。
- 数据：一个 Cloudflare D1，使用 SQL migrations。
- 费用：优先采用轻量结构，但 Cloudflare 用量额度和费用以账户当前计划为准，不承诺所有使用量都永久免费。

## 功能

- 仪表盘从数据库统计客户总数、有效、7 天内到期、已到期、无到期日客户、已知销售额/利润和待补录售价订单数。
- 客户可新增、编辑、按姓名/联系方式搜索、按状态筛选、查看完整购买历史；删除前明确确认，删除客户会级联删除其购买记录。
- 固定成本：月卡 ¥6、季卡 ¥16、年卡 ¥60、白名单 ¥240。每笔订单保存成本快照，不因之后调整默认成本而改写历史利润。
- 购买日期和到期日由使用者填写；不会按卡种推算到期日。售价允许留空，留空订单显示“待补录”，不按零售价计算销售额或利润。续费会新增订单，不覆盖旧记录。
- 到期管理列出未来 1–7 天和已到期订单，含联系方式、卡种、日期与客户历史入口；日期统一按 `Asia/Shanghai` 计算。
- 订单可按客户、卡种和购买日期筛选。客户/订单可分别导出 CSV，含 UTF-8 BOM 并防护 `= + - @` 公式注入。
- 默认深色主题，可切换浅色；窄屏下页面不会整体横向溢出。
- 登录失败限制、兼容 PBKDF2-SHA256 哈希 Secret 的验证、签名会话、`HttpOnly; Secure; SameSite=Strict` Cookie、同源与 CSRF 校验、API 服务端鉴权、参数化 SQL；无公开密码重置接口。管理员密码在本机以 PBKDF2-SHA256（310,000 次迭代）生成哈希；Cloudflare 只保存 `ADMIN_PASSWORD_HASH` Secret。未设置有效哈希时登录与业务 API 均 fail closed；密码本身不会上传到 Cloudflare。

## 部署到 Cloudflare Workers（GitHub 连接）

这是给新手的主流程：在 Cloudflare 选择“Continue with GitHub”，连接公开仓库，由 Workers Builds 执行检查、D1 迁移和 Worker 部署。不要选择 Pages。首次准备需要在 Cloudflare 创建一个专用 D1，并在 Worker 设置里保存一个运行时 Secret；之后代码更新由 GitHub 推送触发。

请先确认 GitHub 仓库已经包含本 README 对应的 Workers Builds 配置脚本，再开始连接。连接向导里先设置下方的构建/部署命令和 D1 ID，再创建或触发构建；不要让默认 `npx wrangler deploy` 先运行。**不要删除旧 Worker 或旧 D1 来试错。旧版 Pages/Worker 的数据不会自动迁移到本 V2 数据库。**

### 首次配置（只需一次）

1. 在 Cloudflare Dashboard 打开 **Workers & Pages → D1 SQL Database → Create database**，创建数据库，名称准确填写：`customer-card-manager-v2-data`。把详情页显示的 Database ID 记下来。请使用你自己的 Cloudflare 账户，并保留旧数据库不动。
2. 打开 **Workers & Pages → Create application → Continue with GitHub**，授权 Cloudflare 读取 GitHub 仓库，选择 `hfdz1119/customer-card-manager-v2` 和 `main`。确认创建的是 **Worker**（不是 Pages），名称必须与仓库 `wrangler.jsonc` 的 `customer-card-manager-v2` 完全一致。
3. 在 GitHub 项目配置页填好：
   - Build command：`npm run check`
   - Deploy command：`npm run deploy:worker-build`
   - Build variable：`D1_DATABASE_ID` = 第 1 步新建 D1 的完整 Database ID（普通变量，不是密码）
   然后保存并创建 Worker。若向导不提供 Build variable 设置入口，就先创建 Worker；首次构建会因缺少 ID 安全退出，之后在 Worker 设置里补上再重试。
4. 如果设置里有分支预览（Preview builds），先关闭它；默认 Preview 命令会尝试建立分支预览，不要让它接触生产 D1。此项目先只部署 `main`，需要预览时应另建预览专用 D1 和独立绑定。
5. 首次构建先检查代码，再验证 `D1_DATABASE_ID` 是否能在当前构建账户中查到、且数据库名称确实是 `customer-card-manager-v2-data`。Cloudflare 自动生成的默认 Workers Builds token 通常没有 D1 权限：在 Worker 的 **Settings → Builds → API token** 编辑/替换构建 token，给目标账户加 **Account → D1 → Edit**，同时保留 Worker 发布权限。若该权限暂时不足，首次构建会在迁移前安全失败；补上权限后重试即可。若默认 token 不能编辑，就创建一个仅限该账户的 token，授予所需的 D1 Edit 和 Workers 发布权限，再选作此 Worker 的 Build token。不要把 API Token 放进仓库或聊天。
6. 权限就绪后重试/运行构建。若账号不匹配、ID 错误、数据库名不符、权限不足或 migration 含有删表/删列/删除数据语句，部署脚本会停止，不应用迁移、不发布 Worker。检查通过后，只应用新增 migration，再发布 Worker + 静态文件；不会创建第二个 D1，也不会清空现有数据。
7. 首个 Worker 发布后，页面会显示管理员尚未初始化，业务 API 保持关闭。先在自己电脑的项目目录运行 `npm run admin:hash`，按终端提示输入两次独立强密码（至少 16 位；输入不会显示）。命令生成 PBKDF2-SHA256 哈希。然后在 Cloudflare → Workers & Pages → **customer-card-manager-v2** → Settings → Variables and Secrets，为 **Production** 添加 Secret：名称 `ADMIN_PASSWORD_HASH`，值粘贴命令输出的哈希并保存。哈希本身也要保密，别贴到聊天、放进代码或提交 GitHub。若已有明文 `ADMIN_PASSWORD` 变量/Secret，删除它；若有旧 `ADMIN_PASSWORD_HASH`，用新哈希替换。首个构建不需要管理员凭据，也可以发布；未设置有效哈希时登录和业务 API 会 fail closed。保存后刷新页面，用刚才输入的原密码登录。
8. 打开 Cloudflare 给出的 Worker URL，用刚设置的密码登录。部署成功不等于迁移旧数据；需要旧客户数据时，先单独备份并规划导入，切勿删除原数据库。

如果你还没填自定义部署命令，先不要运行默认的 `npx wrangler deploy`。回到 **Settings → Builds**，填好自定义构建/部署命令、`D1_DATABASE_ID` 和 D1 权限后再保存/重试。缺少 ID、账号看不到数据库、数据库名不符或有破坏性迁移都会让自定义脚本在迁移/部署前退出。后续每次推送 `main` 会重复检查和部署，不需要重新连接 GitHub、重建 D1 或重新设置密码。

### 后续更新

把新代码推送到 `main` 即会触发 Worker 构建。构建先运行 `npm run check`；检查通过后 `npm run deploy:worker-build` 会验证同一个 D1 ID/名称，应用新增 migration 并部署。`--keep-vars` 会保留 Cloudflare 上已有的运行时变量和 Secrets。不要删除 D1、修改数据库 ID 或复用其他项目的数据库。

### 本地开发和命令

需要 Node.js 20+、Corepack。克隆仓库后：

```sh
corepack pnpm install
npm run dev
```

常用命令：

| 命令 | 用途 |
|---|---|
| `npm run dev` | 本地启动 Vite、Worker 和本地模拟 D1 |
| `npm run build` | TypeScript 检查并构建前端 |
| `npm run check` | 类型检查、测试和生产构建 |
| `npm test` | 自动化测试 |
| `npm run deploy:worker-build` | Cloudflare Workers Builds 的受保护迁移与部署入口；需要 Build 环境的 `D1_DATABASE_ID` 与 Cloudflare 凭据 |
| `npm run deploy` | 本机 Wrangler 交互式部署替代路径（非 GitHub Builds 主流程） |
| `npm run db:migrate` | 本机 Wrangler 的远程迁移替代命令 |
| `npm run db:backup` | 本机 Wrangler 导出远程 D1 到 `backups/` |
| `npm run admin:hash` | 在本机隐藏输入密码并生成 PBKDF2 哈希，供 Cloudflare Secret 使用；不会连接 Cloudflare |
| `npm run admin:password` | 为本地开发环境设置哈希 Secret |
| `npm run admin:password:remote` | 本机 Wrangler 更新远程 `ADMIN_PASSWORD_HASH` 的兼容流程 |

### 备份与恢复

远程 D1 备份命令要求本机已登录正确的 Cloudflare 账户：

```sh
npm run db:backup
```

SQL 备份放在 `backups/`（已加入 `.gitignore`），含客户个人资料，应存到自己控制的加密位置，不要提交 GitHub、发聊天或放公开网盘。恢复前先确认备份文件和目标 D1；优先恢复到新建空库，不要直接导入正在使用的生产库。用 Wrangler `d1 execute <数据库名> --remote --file <备份文件>` 导入新库，确认记录后再按单独的恢复方案切换 Worker 的 `DB` 绑定。若不熟悉这些步骤，保留现有 Worker/D1，先不要恢复或删除资源。

## 安全说明

- 不要提交 `.dev.vars`、`wrangler.local.jsonc`、`wrangler.deploy.jsonc`、Cloudflare 凭据、客户资料或 `backups/`。
- 不要把明文管理员密码放进 Worker Variable、Secret、代码或聊天；只使用本机生成的 `ADMIN_PASSWORD_HASH` Cloudflare Secret。之前截图里曝光过的密码必须视为泄露并更换，不要复用。哈希也须保密。
- `D1_DATABASE_ID` 不是密码，但它必须属于执行构建的同一 Cloudflare 账户。构建脚本先核对账号可见的 ID 与预期数据库名。
- 自动部署会拒绝包含明显破坏性 SQL（删表、删列、清空表等）的 migration；这不是完整的 SQL 安全审计。任何迁移执行前仍应备份，并审查变更。
- 永远保留旧数据库，直到你确认新 Worker、迁移和数据均正确。代码不会自动搬运旧版 Pages 数据。

## 检查

```sh
corepack pnpm install
npm run check
```

生产发布前还应在 Cloudflare Build 记录里确认检查、迁移和 Worker 部署均成功；本地测试不能替代远端部署验证。
