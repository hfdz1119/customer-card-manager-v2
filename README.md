# 白名单售卖管理系统 V2

面向同一媒体服务售卖人员的轻量客户、卡片到期和利润管理工具。每位使用者单独 Fork/部署、独立 Cloudflare D1 和单管理员，不含注册、团队或通用定价系统。

- 前端：React + TypeScript + Vite + Tailwind CSS。
- 后端：一个 Cloudflare Worker，提供 REST API，并通过 Workers Static Assets 同时托管前端。
- 数据：Cloudflare D1；迁移只新增表/索引，不在部署中清空客户表。
- 部署：支持 Cloudflare Workers Builds 直接连接 GitHub；仓库推送后自动检查、应用 D1 migrations 并部署 Worker。也保留 `npm run deploy` 本地一体化部署。
- 管理员密码：以 PBKDF2-SHA256 哈希形式作为 Cloudflare Secret；密码不进入 Git、D1 或前端。

## 功能

- 仪表盘从 D1 查询客户数、状态、销售额、已知利润和待补售价订单数，不含假演示数据。
- 客户新增、编辑、搜索、详情、完整购买历史及删除确认；删除客户时关联购买记录一并删除。
- 固定卡种成本：月卡 ¥6、季卡 ¥16、年卡 ¥60、白名单 ¥240；写入订单的成本快照，后续默认成本更改不重算旧单。
- 每位客户可以有多笔订单；购买日必填、到期日手动输入且可留空、不自动推算；售价允许留空。留空订单利润标为“待补录”，不按零利润统计。
- 到期管理分为未来 7 天内和已到期，按购买记录展示联系方式、到期日和剩余/逾期天数。日历日统一按 `Asia/Shanghai` 业务时区计算。
- 购买记录按客户、卡种和购买日期筛选；客户和购买记录分别导出 CSV，带 UTF-8 BOM、正确引号转义和表格公式前缀保护。
- 默认深色界面，支持浅色切换；手机端导航和内容适配小屏。
- 每个业务 API 服务端鉴权；PBKDF2 密码哈希、签名会话 Cookie、SameSite/HttpOnly/Secure、同源检查与 CSRF Token、登录失败锁定、参数化 SQL。浏览器界面不读取或保存管理员密码。

## Cloudflare Workers 直接连接 GitHub（推荐）

此仓库只包含 V2 代码。请在 Cloudflare Workers Builds 连接 GitHub 仓库 `hfdz1119/customer-card-manager-v2` 的 `main` 分支；不要把它创建成 Pages 项目。

1. 打开 Cloudflare Dashboard → **Workers & Pages** → **Create application** → **GitHub**，授权后选 `hfdz1119/customer-card-manager-v2`，分支选 `main`。Worker 名称必须是 `customer-card-manager-v2`。
2. 构建设置只需改一项：**Build command 留空**，**Deploy command** 填 `npm run deploy:worker-build`，根目录 `/` 保持不变。这个命令会自动执行类型检查、测试、生产构建、D1 迁移和 Worker 部署。
3. 在 Worker 的 **Settings → Builds → Build variables and secrets** 添加 `D1_DATABASE_ID`，值填专用 `customer` D1 的 Database ID。它只用于生成构建时的本地配置，不会写进 Git。
4. 检查这个 Worker 的 **Build token** 有账户级 **D1 Edit** 和 **Workers Scripts Edit** 权限；默认令牌缺少 D1 Edit 时，迁移会被拒绝并停止部署。
5. 点 **Save and Deploy**。后续推送 `main` 就会用同一命令自动检查、构建、迁移并部署；迁移只新增本项目表和索引，不删除客户数据。
6. 首次部署完成后，在自己的电脑终端 clone 这个仓库、安装依赖并登录 Wrangler，再运行下面的安全密码命令。密码会隐藏输入并直接保存为 Worker Secret，不进 Git 或聊天：

   ```sh
   corepack pnpm install
   npx wrangler login
   npm run admin:password:remote
   ```

   设置 Secret 前，后台 API 会提示管理员密码尚未初始化；设置后即可登录，不需要再部署一次。
7. 后续把更新推到这个仓库的 `main`，Cloudflare 就会自动检查、迁移并部署。旧 Pages 版在另一个仓库，保持不动。

如果你已创建这个 Worker，只需到 **Settings → Builds** 把 Deploy command 改好，再添加 `D1_DATABASE_ID` 并确认 Build token 权限后重试。Workers Builds 的预览分支不会自动成为正式生产部署。

## 首次部署（自己的电脑/终端）

准备 Node.js 20 或更新版本、Corepack（或 pnpm）和 Cloudflare 账号。终端需要登录 Cloudflare，首次资源创建/迁移/发布需要 Workers 部署、D1 编辑和 Secret 写入权限。无需 Docker、VPS、付费服务器或 Cloudflare API Token 粘贴到聊天。

1. 在 GitHub Fork 本仓库，然后在终端 clone 你自己的仓库并进入项目目录：

   ```sh
   git clone https://github.com/<你的用户名>/customer-card-manager-v2.git
   cd customer-card-manager-v2
   corepack pnpm install
   ```

2. 登录 Cloudflare（需要浏览器授权一次）：

   ```sh
   npx wrangler login
   ```

3. 运行完整首次部署：

   ```sh
   npm run deploy
   ```

   部署脚本会先运行类型检查、测试和生产构建，再在当前登录的 Cloudflare 账号中查找专用 D1 数据库 `customer`；没有同名数据库时创建一个。若首次发现同名 D1，脚本会要求你在终端确认这是本项目专用库，确认后才会选用；之后会在本机忽略文件中记住 ID，更新时继续使用同一库，不会重建或清空。然后运行未应用的 SQL migrations，检查是否配置 `ADMIN_PASSWORD_HASH`。如果缺少，终端会两次隐藏输入管理员密码（至少 16 位），生成 PBKDF2-SHA256 哈希并直接通过 Wrangler 保存为 Cloudflare Secret，不打印或保存明文密码。最后发布 Worker，并显示访问网址。

   Wrangler 可能会在首次 D1 建库或首次部署时要求确认；按终端提示确认即可。脚本生成的 `wrangler.deploy.jsonc` 包含当前账号的 D1 ID，已加入 `.gitignore`，不要提交它。

4. 首次发布后，打开 Wrangler 输出的网址登录。建议先用临时测试客户验证添加/编辑/删除、创建购买记录、利润和 CSV 导出，再删除测试记录。不要在未确认登录和数据库可用前录真实客户。

本项目是 Workers Static Assets Worker，不是 Cloudflare Pages Functions。用上述 Wrangler 命令部署；不要把旧 Pages 的 `npx wrangler pages deploy` 或普通 Pages 构建当作 V2 的发布流程。

如果只想先创建或复用 D1 配置，不迁移、不发布：

```sh
npm run db:create
```

若已有新 migration 需要手动单独应用：

```sh
npm run db:migrate
```

## 后续更新

拉取自己仓库的新代码后，在终端执行：

```sh
corepack pnpm install
npm run deploy
```

部署脚本对同一 Worker 名称和 D1 名称复用现有资源，只应用 Wrangler 尚未记录的 migration，再构建和发布。不要删除 D1、不要删改已应用的 migration 文件；数据库升级只新增编号递增的 migration。部署不会自动迁移数据到另一个 D1。只修改前端/Worker、没有新 migration 时，命令也安全地跳过已执行迁移。

## 本地开发与命令

先复制 `.dev.vars.example` 为 `.dev.vars`，然后通过安全提示创建本地管理员密码哈希：

```sh
cp .dev.vars.example .dev.vars
npm run admin:password
npm run dev
```

`npm run dev` 会在本机使用 Wrangler 的本地 D1 模拟器，同时启动 Vite（前端热更新）和 Worker API；本地模拟数据不会写到 Cloudflare。首开地址通常为 `http://localhost:5173`。

```sh
npm run dev                 # 本地 UI + Worker API + 本地 D1
npm run build               # TypeScript 与 Vite 生产构建
npm run deploy              # 本地 Wrangler 登录后完整检查、必要迁移、部署
npm run deploy:worker-build # Cloudflare Workers Builds：检查、构建、迁移并部署
npm run db:migrate          # 对 Cloudflare 已登录账号应用未执行迁移
npm run db:backup           # 导出 Cloudflare D1 SQL 备份到 backups/
npm run check               # 类型检查、自动化测试、生产构建
npm run test                # 自动化测试
npm run admin:password      # 隐藏输入，设置本地 .dev.vars 管理员密码
npm run admin:password:remote # 单独更新远程管理员密码 Secret
```

如需在本地单独迁移本地 D1：

```sh
npm run db:migrate:local
```

此命令只针对 Wrangler 本地模拟库，不触碰远程 D1。`.dev.vars`、本地 Wrangler 配置、备份、数据库文件和 `dist/` 都已忽略，不会进入 Git。管理员密码要求至少 16 位，建议使用密码管理器生成随机且仅用于此系统的密码。`ADMIN_PASSWORD_HASH` 改变后，旧会话签名会失效，需要重新登录。不要将秘密或客户资料写入问题截图、聊天、仓库或日志。

## 数据库备份与恢复

备份（需要已登录 Cloudflare、wrangler 可读取对应 D1）：

```sh
npm run db:backup
```

会创建一个时间戳 SQL 文件到本机 `backups/`，文件夹已加入 `.gitignore`。备份可能含所有客户信息，应存放在自己控制的加密位置，不要上传到 GitHub。

恢复前先创建一个空的 D1，并把本地 `wrangler.deploy.jsonc` 中 `DB` 指向新库（不要改 Git 跟踪的模板，也不要对正在使用的生产库做恢复）。先保留当前库独立备份，再在项目目录运行下面命令，将文件名换成实际备份路径：

```sh
npx wrangler d1 execute customer --remote --file ./backups/customer-实际时间.sql --config wrangler.deploy.jsonc
```

这会把 SQL 写入当前绑定的远程数据库；仅指向刚创建的空库后再执行。备份文件含客户资料，应保存在自己控制的安全位置。恢复后重新部署并核对客户与购买记录。当前提供自动备份导出，不自动保留远程备份副本；请自行安排备份文件保存。

## 数据模型与业务规则

- `customers` 保存姓名、可选联系方式和备注；不要求手机号。
- `purchases` 保存卡种、购买/到期日、可空售价、下单时成本快照和备注，并关联客户。
- `login_attempts` 仅保存基于管理员 Secret 的 IP 哈希、计数和临时锁定时间；不保存原始 IP。
- 客户状态按其最新的非空到期日显示：到期日在今天或未来均计为有效；今天起 7 天内（包含今天）同时标为即将到期；到期日早于今天为已到期。没有到期日的客户单独显示，不作为有效客户。到期管理页按每笔购买记录列出到期事项。
- 销售额只合计已填写售价的订单；利润只合计售价明确的订单，等于售价减订单成本快照；售价未知的订单单独显示待补录数量。
- 删除客户时通过 D1 外键级联删除其所有购买历史；界面二次确认明确提示这一点。
- CSV 使用 UTF-8 BOM 和双引号字段；以 `= + - @`（可含前导空白）开头的文本加单引号，降低表格软件公式执行风险。

## 环境与安全

- Workers Builds 的 `D1_DATABASE_ID` 是构建期变量，`ADMIN_PASSWORD_HASH` 是运行期 Worker Secret，二者用途不同；管理员密码只通过 `npm run admin:password:remote` 安全设置。

- `ADMIN_PASSWORD_HASH` 是必需的 Cloudflare Secret，不是普通 Worker 变量。用 `npm run admin:password:remote` 安全设置/轮换；终端会隐藏密码输入。
- 到期日比较固定使用 `Asia/Shanghai` 业务时区；前后端用同一规则，不依赖访问者浏览器时区。
- Worker 不启用 CORS，只接受同源 POST；所有变更接口需要会话和 CSRF Token。
- 密码只在客户端登录请求内存中短暂传输；服务端使用 PBKDF2-SHA256 校验，绝不写数据库。会话用 HMAC 签名，12 小时过期，Cookie 为 `HttpOnly; Secure; SameSite=Strict`。
- 登录错误达到阈值会临时锁定该来源；Cloudflare `CF-Connecting-IP` 通过 Secret 派生 HMAC 后存为哈希。
- 对外公开 GitHub 仓库前，检查提交历史和部署配置，不要提交 `.dev.vars`、本地 deployment config、Cloudflare Secret、客户数据/备份或数据库 ID。

## Cloudflare 免费额度说明

项目不依赖付费服务，适合小规模个人使用，但 Cloudflare 套餐、地区、计费规则和用量会变更；不能保证长期永久免费。上线前请在自己的 Cloudflare 账户查看当前 Workers 与 D1 额度、限制和超额规则。免费额度耗尽、平台政策变化或额外功能用量可能导致限流或产生费用。

## 开发检查

```sh
npm run check
```

覆盖日期/时区和到期边界、固定成本/未知售价利润逻辑、CSV 公式注入防护、登录成功/失败、安全 Cookie、未登录 API 401、跨站请求与 CSRF 拒绝、客户新增/读取/编辑/删除等测试；并执行 TypeScript 检查和 Vite 生产构建。数据库迁移由 Wrangler D1 migration tracking 管理，仅向前新增，migration 文件需保持不可变。
