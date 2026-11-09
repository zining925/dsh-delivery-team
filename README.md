# vibe-delivery-team（交付团队 Vibe Coding 规范插件）

> 项目感知、多角色协作 + 文档驱动 Vibe Coding 规范注入插件。
> Web/Desktop 通过 `/vibe` 命令启动交付模式；无 UI 的宿主按 git 仓库 +
> `AGENTS.md` / `docs/facts/` 双重命中自动激活。激活后向当前 Agent 的 system prompt
> 追加独立的 `DeliveryTeamVibeCodingRules` section。

- **命令启动交付模式**：`/vibe` 开启即强制注入（忽略 git 与配置），`/vibe off` 关闭并禁用插件能力；
  状态为会话级，刷新页面不重置。开启后输入框工具行显示「交付模式」状态胶囊。
- **团队状态面板**：交付模式开启后，胶囊内「团队状态」按钮展开右侧抽屉 —— 五阶段进度、
  7 角色矩阵、当前阶段详情与快捷操作。
- **只追加规则**：不注册自定义工具、不劫持工具、不接管 Agent 循环、不重写原有系统提示。
- **无 UI 宿主保留自动检测**：git 仓库根 + `AGENTS.md` 或 `docs/facts/` 双重命中才自动激活。
- **与其它插件共存**：section 名固定，与 `dsh-project-prompt` 等注入 system prompt 的插件互不覆盖。
- **动态开关**：`/vibe` 命令与 3 个配置项均由 Loader/宿主管理，变更时自动注销/重新注册 section。

---

## 快速开始

### 安装

```sh
# 从 GitHub 安装（推荐）
dsh plugin --profile desktop add github:zining925/dsh-delivery-team

# 或从本地目录安装
dsh plugin --profile desktop add /path/to/vibe-delivery-team
```

安装后重启 DSH（bundle 在启动时组合）。

### 使用

1. 在输入框执行 `/vibe` 开启交付模式；
2. 输入框工具行出现 `交付模式` 状态胶囊、「团队状态」入口和退出 `×`；
3. 点「团队状态」打开右侧面板：五阶段进度、7 角色矩阵、当前阶段详情；
4. `/vibe off` 或点 `×` 退出交付模式。

> 无 UI 的宿主（headless/CLI）会按 git 仓库根存在 `AGENTS.md` 或 `docs/facts/` 自动激活；
> Web/Desktop 会话通过 `/vibe` 显式开启（`/vibe on` 可强制忽略自动检测）。

---

## 1. 团队角色

| 角色 | 职责 | 主要产出 |
| --- | --- | --- |
| **项目经理 PM** | 整体排期、里程碑、依赖管理、风险识别、组织评审、验收卡点、协调角色之间依赖 | 计划、里程碑、风险清单、评审纪要、验收结论 |
| **产品经理** | 需求挖掘、用户角色、用户故事、功能定义、页面流程、PRD、原型说明、需求答疑；需求变更必须走变更记录并更新 facts | `docs/facts/user-stories.md`、`docs/facts/product-functions.md`、`docs/facts/page-structure.md` |
| **UI 设计师** | 基于产品输出的页面结构，输出页面信息架构、布局规范、组件规范、交互说明、页面状态（空态/加载/报错）、设计约束 | 页面信息架构、组件规范、交互与状态说明（作为前端/App 开发输入） |
| **后端开发** | 架构方案、数据库设计、接口定义、业务逻辑、权限、存储、中间件、接口文档；对齐产品与测试 | `docs/facts/technical-solution.md`、`docs/facts/database-schema.md`、接口文档 |
| **前端开发** | Web 端页面、组件、交互、对接后端接口、页面逻辑，对齐 UI 规范 | 前端代码、页面说明、接口联调记录 |
| **App/小程序开发** | 移动端、小程序页面、原生能力、权限、打包适配、与后端接口联调，对齐 UI 规范 | App/小程序代码、打包与适配说明 |
| **测试工程师** | 基于需求、原型、接口文档编写测试用例、P0/P1/P2 分级用例、回归用例、缺陷单、上线准入检查清单 | 测试用例、缺陷单、回归记录、准入检查清单 |

## 2. 五阶段流转（严格串行）

> 硬规则：上一阶段全部产出经过负责人确认、写入 `docs/facts` 固化事实文档之后，才能进入下一阶段。
> **禁止跳阶段、禁止直接写代码。**

| 阶段 | 名称 | 负责人 | 参与角色 | 阶段产出 | 进入下一阶段的条件 |
| --- | --- | --- | --- | --- | --- |
| **01** | 项目骨架建设 | 项目经理 | 产品经理配合确认目录契约 | 目录骨架、`README.md`、`AGENTS.md`、`docs/工程规则.md`、Git 分支规范文档 | 产出确认完成，写入事实结构。**本阶段不做需求、不做设计、不做技术方案** |
| **02** | 用户故事 & 优先级梳理 | 产品经理 | 项目经理参与评审、评估初步风险 | `docs/facts/user-stories.md`（US 编号从 US-001 开始，含角色、场景、动作、结果、P0/P1/P2）；项目经理输出初步风险记录 | 评审通过 → 固化进 facts → 进入阶段 03 |
| **03** | 产品功能、页面结构、交互链路 | 产品经理 | UI 设计师提前参与对齐；项目经理评审 | `docs/facts/product-functions.md`（绑定 US 编号 + 优先级）、`docs/facts/page-structure.md`（页面、路由、跳转、弹窗、状态）；UI 同步输出页面结构说明、页面组件清单、交互规则 | 项目经理核对链路完整性、确认 P0 闭环；评审通过 → 固化 facts → 进入阶段 04 |
| **04** | 技术方案、架构、数据库、接口方案 | 后端开发 | 前端/App 开发参与评估；产品经理、项目经理评审 | `docs/facts/technical-solution.md`、`docs/facts/database-schema.md`；接口文档：对外稳定 API 写入 `docs/facts/`，内部临时接口写入 `docs/Spec/` | 评审通过 → 固化 facts → 进入阶段 05 |
| **05** | 里程碑拆分、迭代计划、任务拆解 & 测试准备 | 项目经理 | 所有角色共同参与估算；测试工程师同步准备用例框架 | `docs/Spec/milestones.md`（每个里程碑绑定 US 编号、责任人、前置依赖、可验证验收条件）；测试计划初稿、测试用例目录、准入准出标准 | 里程碑确认之后，才可以进入开发子任务（单个子任务单独生成 Spec） |

### 阶段 05 内部分工

- **项目经理**：拆分 M1/M2… 里程碑，定义前置依赖、交付节点、验收标准、责任人分配。
- **产品经理**：核对里程碑范围不超出已确认需求。
- **UI 设计师**：确认各里程碑对应的设计交付节点。
- **后端 / 前端 / App 小程序**：工时估算、拆分开发子任务。
- **测试工程师**：基于需求框架搭建测试用例目录、准入准出标准。

## 3. 开发子任务阶段（里程碑内，按需触发）

不属于 5 大主阶段，由项目经理在里程碑确认后发起：

1. 项目经理发起子任务 Spec（`docs/Spec/task-<编号>.md`），分配对应开发角色；
2. 开发角色完成开发后提交给测试工程师执行测试；
3. 测试输出缺陷清单（`docs/Spec/defects.md`），回归验证；
4. **全部 P0 用例通过**后，项目经理组织验收；上线必须人工验收。

### 子任务 Spec 必含字段

任务编号、所属里程碑、关联 US 编号、修改范围、预期行为、验收标准、责任人。
开发与测试共用同一份 Spec。

## 4. 文档契约与统一路径

| 位置 | 内容 | 规则 |
| --- | --- | --- |
| `docs/facts/` | 已确认、锁定的项目事实：`user-stories.md`、`product-functions.md`、`page-structure.md`、`technical-solution.md`、`database-schema.md` | 固化内容不允许随意改动，只能引用复用；变更必须记录原因/影响范围并重新评审 |
| `docs/Spec/` | 动态任务规格、`milestones.md`、迭代计划、测试用例、评审记录、缺陷单 | 随迭代更新 |
| `src/` | 独立 Git 源码仓库 | `main` 分支受保护；`feature` 分支开发；上线必须人工验收 |

**固定路径（统一）**

| 文档 | 路径 |
| --- | --- |
| 工程规则 | `docs/工程规则.md` |
| 评审记录 | `docs/Spec/review-records.md` |
| 缺陷单 | `docs/Spec/defects.md` |
| 接口文档 | 对外稳定 API → `docs/facts/`；内部临时接口 → `docs/Spec/` |

## 5. 加固规则（注入内容，强制）

在原有五阶段规约之上，插件额外注入以下硬规则：

1. **状态锚点**：每次回复第一行必须是 `【当前阶段：<阶段编号与名称>】【角色：<当前角色>】`；
   阶段切换只识别「确认通过」「进入下一阶段」两类明确指令；“可以 / 还行 / 差不多”一律视为修改意见。
2. **越权请求拦截**：要求跳阶段、直接写代码、直接出设计稿时，先输出固定拦截话术，默认拒绝跳步；
   仅用户二次明确确认后，在 `docs/Spec/review-records.md` 记录风险再执行。
3. **角色视角**：默认以项目经理身份统筹；仅用户明确说「切换 XX 角色」「站在 XX 角度」时切换，
   回复锚点带 `【角色：XX】`，不越权输出其他角色决策。
4. **Facts 防篡改**：`docs/facts/` 固化内容禁止直接修改；变更必须记录原因、影响范围、关联编号，
   走评审并在 `docs/Spec/review-records.md` 留存变更日志。
5. **阶段评审清单固定 5 项**：交付物列表（附路径）、上一阶段对齐检查、P0 闭环检查、风险与依赖、待确认问题。
6. **P0 优先**：每个阶段先完整输出 P0 并确认，再处理 P1/P2。
7. **项目规则优先**：本段为团队基线；`AGENTS.md` / `dsh-project-prompt` 注入的项目规则是项目补充，
   冲突时以项目规则为准，但不得违反 P0 闭环、人工验收、禁止跳阶段三条底线。

## 6. 激活规则

### 6.1 双重命中

1. 会话 cwd 位于 git 仓库内（向上查找最近的 `.git`，普通仓库、linked worktree、子模块均可）；
2. 且仓库根存在以下任一项：
   - `AGENTS.md`
   - `docs/facts/` 目录

两者同时满足才激活；否则不注入任何内容。子 Agent 继承 cwd，同样适用。

### 6.2 交付模式命令（最高优先级）

Web/Desktop 会话通过 slash 命令激活，而不是常驻开关：

| 命令 | 行为 |
| --- | --- |
| `/vibe` | 切换交付模式（开启 ⇄ 关闭） |
| `/vibe on` | 强制开启：注入规则，忽略 `enabled` / `autoDetect` 与 git 检测结果 |
| `/vibe off` | 强制关闭：不注入，禁用全部插件能力 |
| `/vibe status` | 查看当前模式与规则注入状态 |

- 默认关闭；模式状态按会话保存于 Host（刷新页面不重置，不同会话互相独立）。
- 命令执行后 Host 立即对现存 Agent 注册/注销 section，无需重启会话或刷新页面。
- 开启后输入框工具行出现「交付模式」状态胶囊（参考计划模式），内含「团队状态」入口与退出按钮。
- 无 UI 的宿主（headless/CLI）保留 6.1 的自动检测；也可以直接用 `/vibe` 手动控制。

### 6.3 配置开关

在 **profile** 的 `cordis.patch.yml` 中按 id 覆盖（注意 patch 会替换整个 `config`）：

```yaml
- id: vibe-delivery-team
  config:
    enabled: false
    autoDetect: true
    silent: false
```

或直接禁用整行：

```yaml
- id: vibe-delivery-team
  disabled: true
```

## 7. 标准配置项

| 配置 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关。`false` 时不注入任何内容；但 `/vibe on` 时 **命令优先** |
| `autoDetect` | boolean | `true` | 自动检测。`false` 时无 UI 宿主永不自动激活；`/vibe on` 时仍强制注入 |
| `silent` | boolean | `false` | 静默模式。`true` 时只注入规则，不输出首次激活引导与模式切换提示，激活日志降为 debug |

**优先级**：会话模式（`/vibe`）> `enabled` / `autoDetect`。命令开启即强制注入，关闭即完全禁用；
无 UI 的宿主才由 `enabled` / `autoDetect` 决定。

**动态生效**：三个配置项由 Loader 管理。配置变更时 Loader 重启插件：旧实例通过
`ctx.effect` 注销全部 section，新实例为现存 Agent 重新注册。启用 HMR 的 profile（如 desktop）
无需重启会话；无 HMR 的 profile 需重启 DSH 后生效。

**配置声明位置**

- `manifest.json` → `configuration`：插件元数据与默认值来源，`index.js` 启动时读取它生成
  schemastery `Config` 的默认值；
- `package.json` → `dsh.bundle.patch`：DSH Loader 真正读取的 bundle 清单；
- profile 的 `cordis.patch.yml`：用户覆盖值（patch 会替换整个 `config`，三个键需一起写）。

## 8. 交付模式：命令启动 + 输入框状态

### 8.1 启动方式

| 命令 | 说明 |
| --- | --- |
| `/vibe` | 切换交付模式 |
| `/vibe on` | 开启（强制注入规则） |
| `/vibe off` | 关闭（停止注入并禁用插件能力） |
| `/vibe status` | 查看模式与注入状态 |

命令在 Host 侧执行；开启后立即注册 `DeliveryTeamVibeCodingRules` section，关闭后立即注销。

### 8.2 输入框状态胶囊（参考计划模式）

- 槽位：`conversation.input.left` —— 输入框工具行左侧，与计划模式等控件同一行；
- 仅交付模式开启时渲染：品牌色状态点 +「交付模式」+「团队状态」按钮 + 退出 `×`；
- 关闭时不渲染任何 UI；
- 客户端每 2.5s 轮询 Host `/mode`，因此命令开启/关闭后状态胶囊会自动出现/消失；
- 点击「团队状态」展开右侧面板；点击 `×` 或执行 `/vibe off` 退出模式。

### 8.3 反馈

非静默模式通过会话上下文输出提示：

- 开启：`✅ 已开启交付模式。团队规范已注入，输入框工具行会显示「交付模式」状态。`
- 关闭：`已关闭交付模式。`

`silent: true` 时只后台生效，不输出提示。

### 8.4 接口

同源请求，必须携带 `x-vibe-delivery-team: 1` 请求头：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/vibe-delivery-team/mode?sessionId=…` | 查询会话模式状态 |
| POST | `/vibe-delivery-team/mode` | body `{ sessionId, enabled }`，立即注册/注销 section（退出按钮使用） |

### 8.5 无 UI 宿主

headless/CLI 同样可以执行 `/vibe`；没有 `webServer` 时不注册状态胶囊与面板接口，
自动检测行为（6.1）保留。

## 9. 交付团队状态面板

### 9.1 入口与显隐

- 「团队状态」按钮位于输入框工具行的「交付模式」状态胶囊内（`conversation.input.left`）；
- 仅当交付模式开启时按钮可见；退出模式时面板自动收起、按钮隐藏；
- 面板展开状态与宽度保存在浏览器 `localStorage`（按 sessionId 隔离），刷新页面不重置，
  不同会话互相独立。

### 9.2 面板结构（右侧抽屉，默认半屏，可拖拽宽度）

1. **项目总进度**：五阶段进度条 —— 阶段01 项目骨架 / 阶段02 用户故事 / 阶段03 功能页面 /
   阶段04 技术方案 / 阶段05 里程碑计划；已完成阶段打勾、当前阶段高亮、未开始阶段置灰；
   下方显示 `当前阶段：阶段XX · XXX` 与整体完成百分比（已完成阶段数 / 5）。
2. **角色状态矩阵**：7 个固定角色逐行展示「角色名 + 状态标签 + 当前任务 + 当前阶段产出物」；
   状态标签：未开始（灰）、进行中（蓝）、待评审（橙）、已完成（绿）；
   产出物存在时标注 ✅。
3. **当前阶段详情**：负责人、参与角色、交付物清单（附路径）、待确认问题数量；
   提供「查看评审清单」与「重置进度」按钮。

### 9.3 交互

| 操作 | 效果 |
| --- | --- |
| 点击角色行 | 等效 `/vibe-role 角色名`，当前视角角色行高亮 |
| 点击产出物文件名 | Host 调用官方 `sessionController.openWorkspacePath` 打开本地文件 |
| 查看评审清单 | 以用户消息触发模型输出当前阶段的固定 5 项评审清单 |
| 重置进度 | 二次确认后等效 `/vibe-reset`（只重置插件跟踪，不删除文档） |
| 拖拽抽屉左边缘 | 调整宽度（340px–90vw），宽度随会话记忆 |

面板打开时每 4 秒从 Host 拉取一次状态，并在每次操作后立即刷新。

### 9.4 数据来源与状态映射

- 数据完全来自会话本身：阶段锚点（`【当前阶段：…】`）、用户「确认通过 / 进入下一阶段」、
  当前角色、产出物文件存在性；**不额外落盘**。
- 阶段切换 → 进度条与全部角色状态自动更新；
- 产出物生成未确认 → 对应角色显示「待评审」；
- 用户确认通过 → 当前阶段角色变为「已完成」，阶段自动 +1；
- 待确认问题数 → 解析最近一次回复中「待确认问题」条目数量。

### 9.5 面板接口

同源请求，需 `x-vibe-delivery-team: 1`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/vibe-delivery-team/state?sessionId=…` | 面板数据（阶段、角色矩阵、交付物、待确认数） |
| POST | `/vibe-delivery-team/role` | body `{ sessionId, role }`，切换角色视角 |
| POST | `/vibe-delivery-team/reset` | body `{ sessionId }`，重置到阶段01 |
| POST | `/vibe-delivery-team/review` | body `{ sessionId }`，触发评审清单输出 |
| POST | `/vibe-delivery-team/open` | body `{ path }`，打开本地文件 |

## 10. Section 注册与顺序

| 项目 | 值 |
| --- | --- |
| section 名称 | `DeliveryTeamVibeCodingRules` |
| section order | `200`（本插件固定） |
| 注册作用域 | Agent 级（`agent.ctx.systemPrompt.section(...)`） |
| 位置约定 | 基础系统提示之后、工具能力描述之前 |

> **API 说明（重要）**：DSH 0.2.2 的官方注册方法名是 `ctx.systemPrompt.section()`，
> 并不存在 `registerSection()`。本插件使用真实存在的官方 API；如果你使用的宿主版本
> 确实提供 `registerSection()`，可等价替换这一行调用。

> **实际内置顺序**（`@deepseek-ai/dsh-system-prompt`）：`-1000` identity、`0` persona、
> `500` plan、`600` team、`900` file-reference、`1000+` 各工具说明。`200` 保证排在
> persona 之后、工具说明之前；若希望排到全部内置基础段之后，可把 `SECTION_ORDER` 调整为 `950`。

## 11. 与 dsh-project-prompt / AGENTS.md 的兼容

- 本插件 section：`DeliveryTeamVibeCodingRules`（order 200）
- `dsh-project-prompt` section：`project-prompt`（默认 order 50）

两者名称不同、可同时安装，互不覆盖。**优先级约定**：

1. 本插件是团队基线规则，位于前；
2. `AGENTS.md` 与 `dsh-project-prompt` 注入的项目规则是项目补充，物理上可能先/后到达，
   但规则文本明确约定：**两者冲突时以项目规则为准**（三条底线除外）。

> 物理顺序说明：`dsh-project-prompt` 默认 order 50，可能排在本插件（200）之前；
> 这不影响语义优先级，因为项目规则覆盖基线是由注入文本显式声明的。

## 12. 轻量内置指令

通过 `ctx.commands.register(...)` 实现，不注册工具，输入即以 `/` 开头的命令：

| 指令 | 作用 |
| --- | --- |
| `/vibe-status` | 查看当前阶段、角色、插件配置、项目检测结果与各阶段产出是否存在 |
| `/vibe-role <角色名>` | 切换角色视角，例如 `/vibe-role 产品经理` |
| `/vibe-reset` | 重置到阶段 01；第一次执行要求二次确认，第二次执行才生效，不删除任何文档 |

阶段状态来自模型回复中的 `【当前阶段：…】` 锚点解析，保存在插件内存中（不跨进程持久化）。
交付模式关闭时，以上命令统一返回“软件交付模式未开启”，不执行任何操作。

## 13. 日志

| 时机 | 日志级别 | 内容 |
| --- | --- | --- |
| 插件加载 | info | `vibe-delivery-team loaded` |
| 命中项目 / 开关开启 | info（silent 时 debug） | `【已激活：多角色交付团队Vibe规范插件】 mode=forced\|auto cwd=… repo=… AGENTS.md=… docs/facts=…` |
| 关闭 / 未命中 | info / 无 | 关闭时打印 disabled 说明；未命中不打印激活日志 |
| 异常 | warn / debug | 激活失败、引导注入失败、命令注册失败等 |

全部使用 `ctx.logger.info()` / `ctx.logger.debug()` / `ctx.logger.warn()`，不使用 `console.log`。

## 14. 安装 / 升级 / 卸载

```sh
# 从 GitHub 安装
dsh plugin --profile desktop add github:zining925/dsh-delivery-team

# 或从本地目录安装
dsh plugin --profile desktop add /path/to/vibe-delivery-team

# 验证组合层
dsh --profile desktop --dump-config | grep -A5 vibe-delivery-team

# 卸载
dsh plugin --profile desktop remove vibe-delivery-team
```

安装/升级后重启 DSH（或依赖 HMR）使新代码生效；安装时若 pnpm 提示
`@deepseek-ai/schemastery` 是 peer 依赖，属于预期警告，DSH 运行时会从宿主解析该包。

## 15. 目录结构

```
vibe-delivery-team/
├── package.json      # DSH bundle 清单：dsh.bundle.patch、engines、peerDependencies
├── manifest.json     # 插件元数据 + configuration 默认值（index.js 读取）
├── cordis.patch.yml  # Loader 层：插入一行 Host 插件 + 三个默认配置
├── index.js          # Host 半：检测、section 注册、开关接口、配置热更新、命令
├── client.js         # Client 半：交付模式状态胶囊 + 团队状态面板（input.left / shell.overlay）
└── README.md         # 本文档
```

> DSH 插件标准中，Loader 读取的清单是 `package.json` 的 `dsh` 字段；
> `manifest.json` 不是 Loader 读取的文件，本插件用它承载插件元数据与配置默认值。

## 16. 验证清单

1. `node --check index.js`、`node --check client.js` 通过；
2. 默认关闭；执行 `/vibe` 后进入交付模式；
3. 开启后（无论在不在 git 仓库）system prompt 出现 `DeliveryTeamVibeCodingRules`，
   会话出现 `✅ 已启用软件交付模式，多角色协作规范已生效`；
4. 关闭后规则段立即消失，会话出现 `已关闭软件交付模式`；刷新页面开关状态保持；
5. `silent: true` 时切换只后台生效，无会话提示；
6. 无 UI 宿主：命中项目（git 根 + `AGENTS.md` 或 `docs/facts/`）时自动注入；
   非 git、无标记、`enabled: false`、`autoDetect: false` 均零注入；
7. `/vibe-status`、`/vibe-role`、`/vibe-reset` 在开关开启时可用，关闭时被禁用；
8. 执行 `/vibe` 后输入框工具行出现「交付模式」状态胶囊；胶囊内「团队状态」展开面板；
   再执行 `/vibe off` 或点击 `×` 后胶囊与面板消失；
9. 面板中点击角色行切换视角并高亮；点击存在产出物可打开本地文件；
   「查看评审清单」触发模型输出固定 5 项；「重置进度」二次确认后回到阶段01；
10. 面板展开状态与宽度刷新页面保持，不同会话独立；
11. 配置变更后插件重启并重新注册 section（启用 HMR 时无需重启会话）。

## 17. 已知限制

- **提示词约束而非硬拦截**：插件不会阻止模型写代码，约束力来自注入规则；需要硬卡点时配合 hooks/权限策略。
- **激活条件较严格**：仓库根必须有 `AGENTS.md` 或 `docs/facts/`；新建项目在阶段 01 完成前不会自动激活。
- **阶段/角色状态在内存中**：DSH 重启或插件重载后回到阶段 01 / 项目经理；`/vibe-reset` 只重置插件跟踪，不删除文档。
- **交付模式状态在 Host 进程内**：刷新页面不重置；DSH 重启后回到默认关闭（会话级状态，不落盘）。
- **Web 会话默认关闭**：首次使用需执行 `/vibe`；无 UI 的 headless/CLI 仍按自动检测运行。
- **首次激活引导按“项目 + 进程”去重**：同一进程内同一项目只引导一次；DSH 重启后会再次引导。
- **物理 section 顺序**受各插件 order 影响：`dsh-project-prompt` 默认 50 可能排在本插件 200 之前；
  语义优先级由规则文本保证。
- **修改 `manifest.json` 的默认值**需重新加载插件才生效；运行时开关请改 profile 配置。
- **面板数据依赖会话信号**：阶段来自 `【当前阶段：…】` 锚点与「确认通过 / 进入下一阶段」，
  待确认问题数为启发式解析；模型未输出锚点时面板可能滞后于实际讨论。
- **面板状态只存在浏览器**：展开状态/宽度使用 `localStorage`（按 sessionId 隔离），
  不写本地文件；换浏览器或清空站点数据会恢复默认。
- **文件打开依赖桌面宿主**：`sessionController.openWorkspacePath` 在 Web/Desktop 可用；
  无桌面打开能力时点击会提示失败。
- **查看评审清单会消耗一次模型回合**：它以用户消息触发模型输出清单，不是本地静态渲染。
