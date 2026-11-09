/**
 * vibe-delivery-team —— 项目感知、多角色协作 + 文档驱动 Vibe Coding 规范注入插件。
 *
 * 插件边界：
 *   - 只通过 DSH 的 systemPrompt section API 追加规则，不注册自定义工具、
 *     不劫持工具、不重写既有 system prompt；
 *   - git 仓库根同时存在 `AGENTS.md` 或 `docs/facts/` 时才激活，避免子目录、
 *     临时目录误触发；
 *   - 提供 3 个 Loader 配置项与 3 个轻量 slash 命令。
 *
 * 实现要点（DSH 0.2.x 公共扩展点）：
 *   - 监听串行事件 `agent/created`，在首个模型请求之前注册 section；
 *   - 从 `agent.session.header.cwd` 读取工作目录并向上查找 `.git`；
 *   - 通过 `agent.ctx.systemPrompt.section(...)` 注册 Agent 作用域 section；
 *   - 配置变更时 Loader 会重启插件：旧实例通过 `ctx.effect` 注销全部 section，
 *     新实例为已存在的 Agent 重新注册，因此开关切换无需重启会话；
 *   - 轻量指令通过 `ctx.commands.register(...)` 实现，不注册工具。
 *
 * 注意：DSH 0.2.2 的官方注册方法名是 `systemPrompt.section()`，
 * 并不存在 `registerSection()`；本插件使用官方实际 API。
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import z from '@deepseek-ai/schemastery';

/** Cordis 插件名。 */
export const name = 'vibe-delivery-team';

/** 硬依赖：systemPrompt 用于注册 section；agents 用于配置热更新时遍历现存 Agent。 */
export const inject = ['systemPrompt', 'agents'];

/** 注入的 section 名称（插件契约的一部分，不应随配置改变）。 */
const SECTION_NAME = 'DeliveryTeamVibeCodingRules';

/**
 * section 排序位置。
 *
 * 插件规约固定为 200：位于基础系统提示之后、工具能力描述之前。
 * DSH 内置顺序参考（@deepseek-ai/dsh-system-prompt 的 SECTION_ORDERS）：
 *   -1000 harness identity / 0 persona / 500 plan / 600 team / 900 file-reference
 *   1000+ 各工具的说明（TOOL_*）。
 * 因此 200 保证排在 persona 与工具说明之间；若某部署希望排到所有内置基础
 * 段之后，可自行调整本常量（或覆盖为 950）。
 */
const SECTION_ORDER = 200;

/** 插件加载日志（规约要求原文）。 */
const LOADED_LOG = 'vibe-delivery-team loaded';

/** 命中项目时的激活日志（规约要求包含该原文）。 */
const ACTIVATED_LOG = '【已激活：多角色交付团队Vibe规范插件】';

/** 输入框开关与 Host 同步接口。 */
const CLIENT_HEADER = 'x-vibe-delivery-team';
const MODE_PATH = '/vibe-delivery-team/mode';

/** 开关切换提示（非静默模式注入到会话）。 */
const NOTICE_ON = '✅ 已启用软件交付模式，多角色协作规范已生效';
const NOTICE_OFF = '已关闭软件交付模式';

/** 会话级 UI 开关状态：sessionId -> boolean。进程内持久化，刷新页面不重置。 */
const sessionModes = new Map();

/** 会话尚无 Live Agent 时暂存切换提示，等首个 Agent 创建后补注入。 */
const pendingNotices = new Map();


/** 阶段定义：命令状态查询与提示词阶段锚点共用。 */
const STAGES = [
  {
    id: '01',
    name: '阶段01 项目骨架建设',
    short: '项目骨架',
    owner: '项目经理',
    participants: ['产品经理'],
    deliverables: ['README.md', 'AGENTS.md', 'docs/工程规则.md'],
    outputs: {
      项目经理: [
        { name: 'README.md', path: 'README.md' },
        { name: 'AGENTS.md', path: 'AGENTS.md' },
        { name: 'docs/工程规则.md', path: 'docs/工程规则.md' },
        { name: '技术栈/交付端确认' },
      ],
      产品经理: [{ name: '目录契约确认' }],
    },
  },
  {
    id: '02',
    name: '阶段02 用户故事梳理',
    short: '用户故事',
    owner: '产品经理',
    participants: ['项目经理'],
    deliverables: ['docs/facts/user-stories.md'],
    outputs: {
      产品经理: [{ name: 'user-stories.md', path: 'docs/facts/user-stories.md' }],
      项目经理: [{ name: '初步风险记录' }],
    },
  },
  {
    id: '03',
    name: '阶段03 产品功能与页面结构',
    short: '功能页面',
    owner: '产品经理',
    participants: ['UI设计师', '项目经理'],
    deliverables: ['docs/facts/product-functions.md', 'docs/facts/page-structure.md'],
    outputs: {
      产品经理: [
        { name: 'product-functions.md', path: 'docs/facts/product-functions.md' },
        { name: 'page-structure.md', path: 'docs/facts/page-structure.md' },
      ],
      UI设计师: [{ name: '页面结构说明' }, { name: '页面组件清单' }],
      项目经理: [{ name: 'P0 闭环核对' }],
    },
  },
  {
    id: '04',
    name: '阶段04 技术方案与数据设计',
    short: '技术方案',
    owner: '后端开发',
    participants: ['前端开发', 'App/小程序开发', '产品经理', '项目经理'],
    deliverables: ['docs/facts/technical-solution.md', 'docs/facts/database-schema.md'],
    outputs: {
      后端开发: [
        { name: 'technical-solution.md', path: 'docs/facts/technical-solution.md' },
        { name: 'database-schema.md', path: 'docs/facts/database-schema.md' },
      ],
      前端开发: [{ name: '端侧限制评估' }],
      'App/小程序开发': [{ name: '端侧兼容评估' }],
      产品经理: [{ name: '需求核对' }],
      项目经理: [{ name: '技术风险与排期' }],
    },
  },
  {
    id: '05',
    name: '阶段05 里程碑与迭代计划',
    short: '里程碑计划',
    owner: '项目经理',
    participants: ['产品经理', 'UI设计师', '后端开发', '前端开发', 'App/小程序开发', '测试工程师'],
    deliverables: ['docs/Spec/milestones.md'],
    outputs: {
      项目经理: [{ name: 'milestones.md', path: 'docs/Spec/milestones.md' }],
      产品经理: [{ name: '范围核对' }],
      UI设计师: [{ name: '设计交付节点' }],
      后端开发: [{ name: '工时估算' }],
      前端开发: [{ name: '工时估算' }],
      'App/小程序开发': [{ name: '工时估算' }],
      测试工程师: [{ name: '测试计划初稿' }],
    },
  },
];

/** 固定角色列表。 */
const ROLES = [
  '项目经理',
  '产品经理',
  'UI设计师',
  '后端开发',
  '前端开发',
  'App/小程序开发',
  '测试工程师',
];

/** 首次激活引导（作为一次性上下文注入，非静默模式）。 */
const GUIDE_MESSAGE = `【交付团队插件 · 首次激活】
本会话已激活交付团队 Vibe 规范，当前处于【阶段01 项目骨架建设】。
请在接下来第一条回复中先向用户输出下面这行引导语（原文照搬），再用一次 ask_user_question 把开工前信息问齐：
已激活交付团队 Vibe 规范。当前处于【阶段01 项目骨架建设】，请提供：项目名称与目标、技术栈（后端/Web/App·小程序）、交付端、核心范围（P0）与本期不做、时间/部署/合规等约束。

澄清规则：技术栈必须给出推荐项但不得替用户拍板；用户明确说“你决定”才采用推荐值，并写入 docs/工程规则.md；技术栈未确认前不要创建目录骨架、不要写代码、不要进入阶段02。`;

/**
 * 从 manifest.json 读取配置默认值，作为 Config schema 的默认值来源。
 * 读取失败时回退到硬编码默认值，保证插件仍可加载。
 */
function readManifestDefaults() {
  try {
    const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
    const configuration = manifest?.configuration ?? {};
    return {
      enabled: configuration.enabled?.default !== false,
      autoDetect: configuration.autoDetect?.default !== false,
      silent: configuration.silent?.default === true,
    };
  } catch {
    return { enabled: true, autoDetect: true, silent: false };
  }
}

const MANIFEST_DEFAULTS = readManifestDefaults();

/** 标准配置 schema：Loader 会校验、补默认值，并在变更时重启插件。 */
export const Config = z.object({
  enabled: z
    .boolean()
    .default(MANIFEST_DEFAULTS.enabled)
    .description('总开关：false 时不注入任何内容，并注销已注册的 section'),
  autoDetect: z
    .boolean()
    .default(MANIFEST_DEFAULTS.autoDetect)
    .description('自动检测：false 时永不自动激活'),
  silent: z
    .boolean()
    .default(MANIFEST_DEFAULTS.silent)
    .description('静默模式：true 时只注入规则，不输出首次激活引导'),
});

const BASE_RULES = `## 交付团队 Vibe Coding 规范（DeliveryTeamVibeCodingRules）

你是交付团队AI协作助手，团队固定角色：项目经理 PM、产品经理、UI设计师、后端开发、前端开发、App/小程序开发、测试工程师。
严格串行执行5阶段流程，**上一阶段全部产出经过负责人确认、写入 docs/facts 固化事实文档之后，才能进入下一阶段，禁止跳阶段、禁止直接写代码**。
文档契约保持不变：
- docs/facts/：已确认、锁定的项目事实：user-stories.md、product-functions.md、page-structure.md、technical-solution.md、database-schema.md，固化内容不允许随意改动，引用复用。
- docs/Spec/：动态任务规格、milestones.md、迭代计划、测试用例、评审记录（docs/Spec/review-records.md）、缺陷单（docs/Spec/defects.md）。
- src/：独立Git源码仓库，main分支受保护，feature分支开发，上线必须人工验收。
优先级定义：P0=版本必做，核心链路缺失则不可上线；P1=体验优化，不阻塞主流程；P2=次要细节，可后置。

## 角色职责总规则
1. 项目经理：整体排期、里程碑、依赖管理、风险识别、组织评审、验收卡点、协调角色之间依赖，输出计划、风险清单、评审纪要。
2. 产品经理：需求挖掘、用户角色、用户故事、功能定义、页面流程、PRD、原型说明、需求答疑；所有需求变更必须走变更记录，更新facts文档。
3. UI设计师：基于产品输出的页面结构，输出页面信息架构、布局规范、组件规范、交互说明、页面状态（空态/加载/报错）、设计约束；产出物写入文档，作为前端/App开发输入。
4. 后端开发：架构方案、数据库设计、接口定义、业务逻辑、权限、存储、中间件、接口文档；对齐产品、测试。
5. 前端开发：Web端页面、组件、交互、对接后端接口、页面逻辑，对齐UI规范。
6. App/小程序开发：移动端、小程序页面、原生能力、权限、打包适配、与后端接口联调，对齐UI规范。
7. 测试工程师：基于需求、原型、接口文档编写测试用例、P0/P1/P2分级用例、回归用例、缺陷单、上线准入检查清单。

## 分阶段角色激活 & 阶段产出规则（强制）
阶段01｜项目骨架建设【负责人：项目经理】
输入：项目背景、项目名称、目标简述、技术栈、交付端与约束
角色：项目经理主导，产品配合确认目录契约
产出：目录骨架、README.md、AGENTS.md、docs/工程规则.md（记录技术栈/交付端/约束）、Git分支规范文档；确认完成，写入事实结构。
准入（强制）：开工前必须用一次 ask_user_question 向用户澄清并确认：项目名称与目标；后端/数据库、Web、App·小程序的技术栈；交付端；核心范围（P0 3–8 条）与本期不做；时间/部署/合规/既有系统约束。未确认技术栈前不得创建骨架、不得写代码、不得进入阶段02；不得替用户假设技术栈；用户明确说“你决定”时才用推荐值并记录。
本阶段不做需求、不做设计、不做技术方案。

阶段02｜用户故事 & 优先级梳理【负责人：产品经理；项目经理参与评审】
输入：项目骨架、业务目标
角色：产品经理主导；项目经理参与评审、评估初步风险
产出：docs/facts/user-stories.md，US编号US-001开始，包含角色、场景、动作、结果、P0/P1/P2；项目经理输出初步风险记录。
评审通过 → 固化进facts，进入阶段03。

阶段03｜产品功能、页面结构、交互链路【负责人：产品经理；UI设计师提前参与对齐；项目经理评审】
输入：已确认用户故事
角色：产品经理输出功能清单、页面结构、跳转链路；UI设计师同步输出页面结构说明、页面组件清单、交互规则；项目经理核对链路完整性，确认P0闭环。
产出：
docs/facts/product-functions.md（绑定US编号+优先级）
docs/facts/page-structure.md（页面、路由、跳转、弹窗、状态）
评审通过 → 固化facts，进入阶段04。

阶段04｜技术方案、架构、数据库、接口方案【负责人：后端开发；前端/App开发参与评估；产品、项目经理评审】
输入：功能+页面结构文档
角色：后端主导架构选型、数据流、表结构、索引、接口契约；前端、App/小程序开发评估端侧限制、兼容性；产品核对是否满足需求；项目经理评估技术风险、排期影响。
产出：
docs/facts/technical-solution.md
docs/facts/database-schema.md
接口文档：对外稳定 API 写入 docs/facts/；内部临时接口写入 docs/Spec/。
评审通过 → 固化facts，进入阶段05。

阶段05｜里程碑拆分、迭代计划、任务拆解 & 测试准备【负责人：项目经理；所有角色共同参与估算；测试同步准备用例框架】
输入：全部已确认facts文档
角色分工：
- 项目经理：拆分M1/M2…里程碑，定义前置依赖、交付节点、验收标准、责任人分配
- 产品：核对里程碑范围不超出已确认需求
- UI：确认各里程碑对应的设计交付节点
- 后端、前端、App/小程序：工时估算、拆分开发子任务
- 测试工程师：基于需求框架搭建测试用例目录、准入准出标准
产出：docs/Spec/milestones.md，每个里程碑绑定US编号、责任人、前置依赖、可验证验收条件；测试输出测试计划初稿。
里程碑确认之后，才可以进入开发子任务（单个子任务单独生成Spec）。

## 开发子任务阶段（里程碑内，按需触发，不属于5大主阶段）
由项目经理发起子任务Spec（docs/Spec/task-<编号>.md），分配对应开发角色；开发角色完成开发后提交给测试工程师执行测试；测试输出缺陷清单（docs/Spec/defects.md），回归验证；全部P0用例通过，项目经理组织验收。

## 交互硬性约束
1. 每一个阶段结束，自动输出【阶段评审清单】，列出所有交付物，等待人工评审确认；**没有收到“确认通过”指令，禁止进入下一阶段**。
2. 跨角色疑问，直接明确提问对应角色，不要自行脑补；例如接口疑问找后端、交互疑问找UI、需求疑问找产品、排期风险找项目经理。
3. 需求变更：任何变更，先通知项目经理，评估影响，更新facts文档，重新走评审，不允许开发阶段私自改需求。
4. 测试必须在开发完成之后执行，P0用例不通过不允许进入验收。
5. 所有角色产出物，全部落文档，文档作为上下游唯一交付凭证。`;

const HARDENING_RULES = `## 加固规则（强制，优先级高于本段之前的流程描述）

### 0. 开工前澄清（阶段01准入，强制）
- 用户提出项目/想法后，第一步不是建目录，而是用一次 ask_user_question 问齐：项目名称与目标；后端/数据库、Web、App·小程序的技术栈；交付端；核心范围（P0 3–8 条）与本期不做；约束（时间/部署/合规/既有系统）。
- 技术栈必须给出推荐项，但不得替用户拍板；用户明确说“你决定”才采用推荐项，并在 docs/工程规则.md 记录。
- 未确认技术栈前：不创建目录骨架、不写代码、不进入阶段02；只复述待确认项。
- 已确认的技术栈、交付端与约束写入 docs/工程规则.md，后续阶段引用，不得擅自更换。

### 1. 状态锚点（每次回复必须）
- 每次回复的第一行必须是状态锚点，格式固定为：【当前阶段：<阶段编号与名称>】【角色：<当前角色>】。
- 阶段切换只识别两类明确指令：「确认通过」「进入下一阶段」。
- 用户说“可以”“还行”“差不多”“好的”等模糊表达，一律视为修改意见，不推进阶段，并复述当前待确认点。
- 阶段推进后，下一次回复的锚点必须立即更新为新阶段。

### 2. 越权请求拦截
- 用户要求直接跳阶段、直接写代码、直接出设计稿或跳过评审时，先输出拦截话术（原文照搬）：
  > 当前处于 XX 阶段，前置产出尚未固化确认，直接跳过会破坏文档驱动流程。是否确认跳过并记录风险？
- 默认拒绝跳步；仅当用户二次明确确认（如「确认跳过」「确认，记录风险」）后，才在 docs/Spec/review-records.md 记录风险，再执行。
- 不得以“先做着看看”“先出个 demo”“时间紧”为理由绕过阶段流程。

### 3. 角色视角
- 默认以项目经理身份统筹推进；阶段负责人仍按阶段规则执行。
- 仅当用户输入「切换XX角色」「站在XX角度」时切换视角；切换后状态锚点带【角色：XX】，并严格只输出该角色职责范围内的内容，不代替其他角色做决策。
- 角色视角与阶段职责冲突时：阶段推进与验收由阶段负责人/项目经理决定，当前视角只影响表达与关注点。

### 4. Facts 防篡改
- docs/facts/ 下已固化内容禁止直接修改；任何变更必须先记录变更原因、影响范围、涉及的 US/功能编号，提交评审，确认后更新，并在 docs/Spec/review-records.md 留存变更日志。
- 引用 facts 时只读复用；发现不一致时提出变更，不擅自改文件。

### 5. 开发子任务 Spec
- 每个开发子任务必须在 docs/Spec/ 下建立独立文件（建议命名 task-<编号>.md），包含：任务编号、所属里程碑、关联 US 编号、修改范围、预期行为、验收标准、责任人。
- 开发与测试共用同一份 Spec；测试用例、缺陷单、评审记录分别归档到 docs/Spec/。

### 6. 阶段评审清单（固定 5 项）
每次阶段收尾必须按顺序输出：
1. 交付物列表（附路径）
2. 上一阶段对齐检查
3. P0 闭环检查
4. 风险与依赖
5. 待确认问题
未收到「确认通过」前不得推进。

### 7. P0 优先
每个阶段先完整输出 P0 内容并等待确认，再处理 P1/P2；禁止一次性倾倒全部内容导致 P0 被稀释。

### 8. 文档路径统一
- 工程规则：docs/工程规则.md
- 评审记录：docs/Spec/review-records.md
- 缺陷单：docs/Spec/defects.md
- 接口文档：对外稳定 API 写入 docs/facts/；内部临时接口写入 docs/Spec/。

### 9. 与项目规则的关系
本段是团队基线规则，默认优先执行；项目自带规则（AGENTS.md、dsh-project-prompt 注入的项目规则）视为项目补充。两者冲突时，以项目规则为准，但不得违反三条底线：P0 闭环、人工验收、禁止跳阶段。`;

/** 项目 → 会话状态：阶段、角色、重置二次确认。 */
const agentStates = new Map();

/** 每个进程内已输出过首次激活引导的项目根，避免重复引导。 */
const guidedRepos = new Set();

/** 是否超时未清理的瞬时状态由 Agent 生命周期负责，见 agent/disposed。 */
function defaultState() {
  return { stage: STAGES[0].name, role: ROLES[0], resetPending: false, pendingQuestions: 0 };
}

/** 读取（或创建）某个 Agent 的会话状态。 */
function stateOf(agentId) {
  const key = String(agentId ?? '');
  let state = agentStates.get(key);
  if (state === undefined) {
    state = defaultState();
    agentStates.set(key, state);
  }
  return state;
}

/** 判断路径是否存在。 */
function pathExists(target) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

/** 判断路径是否为目录。 */
function isDirectory(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 从 cwd 向上查找最近的 `.git` 入口。
 *
 * - `.git` 是目录：普通工作区；
 * - `.git` 是文件：linked worktree 或子模块，仍视为 git 仓库内。
 *
 * @param {string} startDir - 会话 cwd。
 * @returns {string | undefined} 仓库根目录；不在任何仓库内时返回 undefined。
 */
function findGitRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (pathExists(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * 项目双重命中检测：git 仓库根 + 根下存在 `AGENTS.md` 或 `docs/facts/`。
 *
 * @param {string} cwd - 会话 cwd。
 * @returns {{ root: string, hasAgents: boolean, hasFacts: boolean } | undefined}
 */
function detectProject(cwd) {
  const root = findGitRoot(cwd);
  if (root === undefined) return undefined;
  const hasAgents = pathExists(join(root, 'AGENTS.md'));
  const hasFacts = isDirectory(join(root, 'docs', 'facts'));
  if (!hasAgents && !hasFacts) return undefined;
  return { root, hasAgents, hasFacts };
}

/** 拼接一条消息里的全部文本块。 */
function textOfMessage(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
      text += '\n';
    }
  }
  return text.trim();
}

/** 把模型输出的阶段锚点归一化为标准阶段名。 */
function normalizeStageLabel(label) {
  const match = /阶段\s*0?([1-5])/.exec(label);
  if (match === null) return label;
  const stage = STAGES[Number(match[1]) - 1];
  return stage === undefined ? label : stage.name;
}

/** 从阶段名解析 1..5 的阶段序号；解析失败按阶段 01 处理。 */
function stageIndexOf(label) {
  const match = /阶段\s*0?([1-5])/.exec(String(label ?? ''));
  if (match === null) return 1;
  return Math.min(5, Math.max(1, Number(match[1])));
}

/**
 * 从回复文本中解析“待确认问题”的数量。
 *
 * 识别“待确认问题”之后的列表项，遇到下一个标题或空段落即停止；
 * 没有该段落时返回 undefined（保持原值）。
 */
function parsePendingQuestions(text) {
  const anchor = text.lastIndexOf('待确认问题');
  if (anchor < 0) return undefined;
  const tail = text.slice(anchor + '待确认问题'.length);
  const lines = tail.split(/\r?\n/).slice(0, 40);
  let count = 0;
  for (const line of lines) {
    if (/^\s*(?:[-*]|\d+[.、)])\s+\S/.test(line)) {
      count += 1;
      continue;
    }
    if (count > 0 && /^\s*(?:#{2,}|[0-9]+\s*[.、]\s*\S)/.test(line)) break;
  }
  return count;
}

/** 阶段锚点正则：允许中英文冒号。 */
const STAGE_ANCHOR = /【当前阶段[:：]\s*([^】]+)】/;

/**
 * 监听会话事件，从 assistant 消息里解析【当前阶段：…】锚点。
 *
 * @param {{ id?: unknown }} session
 * @param {{ type?: string, data?: { message?: unknown } }} event
 */
function trackStageFromEvent(session, event) {
  if (event === null || typeof event !== 'object') return;
  const key = String(session?.id ?? '');
  const state = agentStates.get(key);
  if (state === undefined) return;

  // 用户明确确认：立即推进阶段（模型回复中的新锚点随后会再次确认）。
  if (event.type === 'user/message') {
    const text = textOfMessage(event.data?.message);
    if (/(确认通过|进入下一阶段)/.test(text)) {
      const index = stageIndexOf(state.stage);
      if (index < 5) state.stage = STAGES[index].name;
      state.pendingQuestions = 0;
    }
    return;
  }

  if (event.type !== 'assistant/message') return;
  const text = textOfMessage(event.data?.message);
  if (text === '') return;
  const match = STAGE_ANCHOR.exec(text);
  if (match !== null) {
    const label = match[1].trim();
    if (label !== '') state.stage = normalizeStageLabel(label);
  }
  const pending = parsePendingQuestions(text);
  if (pending !== undefined) state.pendingQuestions = pending;
}

/** 构造注入给模型的规则全文（按当前状态动态生成锚点说明）。 */
function buildRulesText(state) {
  return `${BASE_RULES}

当前会话状态（由插件维护，随指令更新）：
【当前阶段：${state.stage}】【角色：${state.role}】

${HARDENING_RULES}`;
}

/** 只在非静默模式下、每个项目首次激活时注入一次引导语。 */
function maybeInjectGuide(agent, project, config, logger) {
  if (config.silent) return;
  if (guidedRepos.has(project.root)) return;
  guidedRepos.add(project.root);
  try {
    agent.inject({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: GUIDE_MESSAGE }],
      source: { kind: 'vibe-delivery-team', form: 'instructions' },
    });
  } catch (error) {
    logger.warn(`guide injection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 从命令原始输入里去掉命令名，得到参数。 */
function commandArg(rawInput, commandName) {
  const raw = typeof rawInput === 'string' ? rawInput.trim() : '';
  return raw.replace(new RegExp('^/' + commandName + '\\b\\s*', 'i'), '').trim();
}

/** 宽松匹配角色名，支持“产品”“产品经理”“切换产品经理”等写法。 */
function matchRole(input) {
  const cleaned = input.replace(/切换|视角|角色/g, '').trim();
  if (cleaned === '') return undefined;
  return (
    ROLES.find((role) => role === cleaned)
    ?? ROLES.find((role) => role === input)
    ?? ROLES.find((role) => role.includes(cleaned) || cleaned.includes(role))
  );
}

/** 构造 /vibe-status 的返回文本。 */
function statusText(agent, config, modeInfo) {
  const state = stateOf(agent?.id);
  const cwd = agent?.session?.header?.cwd;
  const project = typeof cwd === 'string' && cwd !== '' ? detectProject(cwd) : undefined;
  const root = project?.root ?? (typeof cwd === 'string' ? cwd : undefined);
  const modeLabel = modeInfo.mode === 'on'
    ? '开启（/vibe 命令，强制注入）'
    : modeInfo.mode === 'off'
      ? '关闭（/vibe off，不注入）'
      : '自动检测（无 UI 的宿主）';

  const lines = [
    '【vibe-status】',
    `软件交付模式：${modeLabel}`,
    `规则注入：${modeInfo.active ? '已注入' : '未注入'}`,
    `当前阶段：${state.stage}`,
    `当前角色：${state.role}`,
    `插件配置：enabled=${String(config.enabled)} autoDetect=${String(config.autoDetect)} silent=${String(config.silent)}`,
    `项目检测：${project === undefined ? '未命中（需 git 仓库根存在 AGENTS.md 或 docs/facts/）' : `命中 ${project.root}（AGENTS.md=${String(project.hasAgents)} docs/facts=${String(project.hasFacts)}）`}`,
    '',
    '各阶段产出：',
  ];

  for (const stage of STAGES) {
    const fields = stage.deliverables.map((item) => `${root !== undefined && pathExists(join(root, item)) ? '✔' : '—'} ${item}`);
    lines.push(`- ${stage.name}【${stage.owner}】${fields.join('  ')}`);
  }

  lines.push('', '待确认项：以最近一次【阶段评审清单】为准（插件不持久化评审状态）。');
  return lines.join('\n');
}

/** 注册 3 个轻量 slash 命令；commands 服务缺失时降级为 debug 日志。 */
function registerCommands(ctx, logger, config, helpers) {
  const commands = ctx.get('commands');
  if (commands === undefined || commands === null || typeof commands.register !== 'function') {
    logger.debug('commands service unavailable — /vibe-status, /vibe-role, /vibe-reset not registered');
    return;
  }

  const safe = (handler) => (invocation) => {
    try {
      return handler(invocation);
    } catch (error) {
      return { kind: 'error', text: `vibe-delivery-team: ${error instanceof Error ? error.message : String(error)}` };
    }
  };

  /** 开关关闭时禁用全部插件能力。 */
  const gate = (agent) => {
    if (helpers.isActive(agent)) return undefined;
    return {
      kind: 'error',
      text: '交付模式未开启：请先执行 /vibe。',
    };
  };

  /** 注册一个命令；重复名或注册失败只告警，不影响插件主体加载。 */
  const addCommand = (definition) => {
    try {
      ctx.effect(() => commands.register(definition));
    } catch (error) {
      logger.warn(`failed to register command ${definition.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  addCommand({
    name: 'vibe',
    description: '开启/关闭交付模式：/vibe、/vibe on|off|status',
    input: { hint: 'on | off | status' },
    handler: safe(({ agent, rawInput }) => {
      // 容错：无论 rawInput 是空、参数、还是回显的命令名/提示文本，都按关键字解析；
      // 无法识别时默认切换模式，保证 /vibe 一定能启用。
      const cleaned = commandArg(rawInput, 'vibe')
        .replace(/^(?:vibe|delivery)\b[\s,，]*/i, '')
        .trim()
        .toLowerCase();

      if (cleaned === 'status' || cleaned === '状态' || cleaned.startsWith('status')) {
        const mode = helpers.modeOf(agent);
        const active = helpers.isActive(agent);
        const label = mode === 'on' ? '开启' : mode === 'off' ? '关闭' : '自动检测';
        return {
          kind: 'success',
          text: `交付模式：${label}；规则注入：${active ? '已注入' : '未注入'}。用法：/vibe [on|off|status]`,
        };
      }

      let explicit;
      if (/^(on|enable|开启|启用)/.test(cleaned)) explicit = true;
      else if (/^(off|disable|关闭|退出)/.test(cleaned)) explicit = false;

      const enabled = helpers.setDelivery(agent, explicit);
      return {
        kind: 'success',
        text: enabled
          ? '✅ 已开启交付模式。团队规范已注入，输入框工具行会显示「交付模式」状态；输入 /vibe off 或点击状态胶囊的 × 可退出。'
          : '已关闭交付模式。输入 /vibe 可重新开启。',
      };
    }),
  });

  addCommand({
    name: 'vibe-status',
    description: '查看软件交付模式、当前阶段、角色与各阶段产出是否存在。',
    handler: safe(({ agent }) => {
      const blocked = gate(agent);
      if (blocked !== undefined) return blocked;
      const mode = helpers.modeOf(agent);
      return {
        kind: 'success',
        text: statusText(agent, config, { mode, active: helpers.isActive(agent) }),
      };
    }),
  });

  addCommand({
    name: 'vibe-role',
    description: '快速切换角色视角，例如 /vibe-role 产品经理。',
    input: { hint: '角色名' },
    handler: safe(({ agent, rawInput }) => {
      const blocked = gate(agent);
      if (blocked !== undefined) return blocked;
      const role = matchRole(commandArg(rawInput, 'vibe-role'));
      if (role === undefined) {
        return {
          kind: 'error',
          text: `未识别角色。可选：${ROLES.join('、')}。示例：/vibe-role 产品经理`,
        };
      }
      const state = stateOf(agent.id);
      state.role = role;
      return {
        kind: 'success',
        text: `已切换角色视角：【${role}】。后续规则注入与回复锚点将使用该角色；阶段推进仍由阶段负责人/项目经理决定。`,
      };
    }),
  });

  addCommand({
    name: 'vibe-reset',
    description: '重置到阶段01（需二次确认，不会删除任何文档）。',
    handler: safe(({ agent }) => {
      const blocked = gate(agent);
      if (blocked !== undefined) return blocked;
      const state = stateOf(agent.id);
      if (state.resetPending) {
        state.stage = STAGES[0].name;
        state.role = ROLES[0];
        state.resetPending = false;
        return {
          kind: 'success',
          text: `已重置：当前阶段【${STAGES[0].name}】，角色【${ROLES[0]}】。已存在的文档不会被删除。`,
        };
      }
      state.resetPending = true;
      return {
        kind: 'success',
        text: '重置会把插件跟踪的阶段与角色恢复到阶段01/项目经理，但不会删除任何文档。如确认，请再次输入 /vibe-reset。',
      };
    }),
  });
}

/** 写 JSON 响应。 */
function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

/** 读取 GET 查询参数。 */
function queryParam(request, key) {
  try {
    return new URL(request.url ?? '/', 'http://localhost').searchParams.get(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/** 读取 JSON 请求体（上限 1 MB）。 */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(data === '' ? {} : JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

/** 取错误文本。 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 插件入口。
 *
 * @param {import('cordis').Context} ctx - Cordis 上下文。
 * @param {{ enabled?: boolean, autoDetect?: boolean, silent?: boolean } | undefined} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = {
    enabled: typeof rawConfig?.enabled === 'boolean' ? rawConfig.enabled : MANIFEST_DEFAULTS.enabled,
    autoDetect: typeof rawConfig?.autoDetect === 'boolean' ? rawConfig.autoDetect : MANIFEST_DEFAULTS.autoDetect,
    silent: typeof rawConfig?.silent === 'boolean' ? rawConfig.silent : MANIFEST_DEFAULTS.silent,
  };
  const logger = ctx.logger('vibe-delivery-team');

  logger.info(LOADED_LOG);

  // Web/Desktop 的 webServer 可能在插件 apply 之后才就绪：用动态 inject 等待，
  // 避免冷启动时误判为 headless（路由缺失、面板/状态胶囊无法工作）。
  let hasUi = false;

  /** Agent id → section disposer。 */
  const disposers = new Map();

  /** 注销单个 Agent 的 section。 */
  const disposeSection = (id) => {
    const dispose = disposers.get(id);
    if (dispose === undefined) return;
    try {
      dispose();
    } catch (error) {
      logger.debug(`failed to dispose section for agent ${id}: ${errorText(error)}`);
    }
    disposers.delete(id);
  };

  /** 注销本实例注册的全部 section（插件卸载/配置变更时调用）。 */
  const disposeSections = () => {
    for (const [id, dispose] of disposers) {
      try {
        dispose?.();
      } catch (error) {
        logger.debug(`failed to dispose section for agent ${id}: ${errorText(error)}`);
      }
    }
    disposers.clear();
  };

  // 配置变更会重启插件：旧实例在这里注销全部 section，新实例重新注册。
  ctx.effect(() => disposeSections);

  /**
   * 解析一个 Agent 的开关模式：
   *   'on'   —— UI 开关开启：强制注入，忽略 enabled/autoDetect 与 git 检测；
   *   'off'  —— UI 开关关闭：强制不注入，禁用全部插件能力（Web 会话默认）；
   *   'auto' —— 无 UI 的宿主：保留原有 git 自动检测行为。
   */
  const modeOf = (agent) => {
    const id = String(agent?.id ?? '');
    if (sessionModes.has(id)) return sessionModes.get(id) ? 'on' : 'off';
    const parent = agent?.session?.header?.parentSession;
    if (parent !== undefined && sessionModes.has(String(parent))) {
      return sessionModes.get(String(parent)) ? 'on' : 'off';
    }
    return hasUi ? 'off' : 'auto';
  };

  /**
   * 为一个 Agent 注册规则 section。
   *
   * @param {{ id?: unknown, session?: { header?: { cwd?: string } }, ctx?: unknown, inject?: Function }} agent
   * @param {{ root: string, hasAgents: boolean, hasFacts: boolean } | undefined} project
   * @param {'auto' | 'forced'} mode
   */
  const registerSection = (agent, project, mode) => {
    const id = String(agent?.id ?? '');
    if (id === '' || disposers.has(id)) return;
    try {
      const dispose = agent.ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: (context) => buildRulesText(stateOf(context?.agent?.id ?? id)),
      });
      disposers.set(id, dispose);
      stateOf(id); // 确保后续命令/事件有状态对象

      const cwd = agent?.session?.header?.cwd;
      const detail = `${ACTIVATED_LOG} mode=${mode}${typeof cwd === 'string' ? ` cwd=${cwd}` : ''}`
        + (project === undefined
          ? ''
          : ` repo=${project.root} AGENTS.md=${project.hasAgents ? 'yes' : 'no'} docs/facts=${project.hasFacts ? 'yes' : 'no'}`);
      if (config.silent) logger.debug(detail);
      else logger.info(detail);

      // 首次激活引导仅在能识别项目时输出（非静默模式）。
      if (project !== undefined) maybeInjectGuide(agent, project, config, logger);
    } catch (error) {
      // agent/created 是串行事件，抛错会导致 Agent 创建失败；这里只记录。
      logger.warn(`activation failed for agent ${id}: ${errorText(error)}`);
    }
  };

  /** 按当前模式对单个 Agent 应用或撤销注入。 */
  const applyAgent = (agent) => {
    const id = String(agent?.id ?? '');
    if (id === '') return;
    const cwd = agent?.session?.header?.cwd;
    const project = typeof cwd === 'string' && cwd !== '' ? detectProject(cwd) : undefined;
    const mode = modeOf(agent);

    if (mode === 'off') {
      disposeSection(id);
      return;
    }
    if (mode === 'auto') {
      if (!config.enabled || !config.autoDetect || project === undefined) {
        disposeSection(id);
        return;
      }
      registerSection(agent, project, 'auto');
      return;
    }
    // mode === 'on'：UI 开关优先级最高，忽略 enabled/autoDetect 与 git 检测结果。
    registerSection(agent, project, 'forced');
  };

  /** 判断 Agent 是否属于某个会话（含子 Agent 的 parentSession 链）。 */
  const belongsToSession = (agent, sessionId) => {
    const target = String(sessionId ?? '');
    if (target === '') return false;
    let current = agent;
    let depth = 0;
    while (current !== undefined && depth < 8) {
      if (String(current.id) === target) return true;
      const parentId = current.session?.header?.parentSession;
      if (parentId === undefined) return false;
      current = ctx.agents.get(parentId);
      depth += 1;
    }
    return false;
  };

  /** 对一个会话及其子 Agent 重新应用开关状态。 */
  const applySession = (sessionId) => {
    for (const agent of ctx.agents.list()) {
      if (belongsToSession(agent, sessionId)) applyAgent(agent);
    }
  };

  /**
   * 切换交付模式（/delivery 命令与退出按钮共用）。
   *
   * @param {{ id?: unknown, session?: { header?: { cwd?: string } } }} agent
   * @param {boolean | undefined} explicit - 指定 on/off；省略则切换。
   * @returns {boolean} 切换后的状态。
   */
  const setDelivery = (agent, explicit) => {
    const id = String(agent?.id ?? '');
    const current = modeOf(agent) === 'on' || (modeOf(agent) === 'auto' && disposers.has(id));
    // 无 UI 的宿主仍服从 enabled=false，命令不能被用来绕过部署配置。
    if (!hasUi && !config.enabled) return current;
    const enabled = typeof explicit === 'boolean' ? explicit : !current;
    sessionModes.set(id, enabled);
    applySession(id);
    notifyToggle(id, enabled);
    return enabled;
  };

  /** 注入一条切换提示；静默模式下不输出。 */
  const injectNotice = (agent, text) => {
    if (config.silent) return false;
    try {
      agent.inject({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'vibe-delivery-team', form: 'instructions' },
      });
      return true;
    } catch (error) {
      logger.debug(`notice injection failed: ${errorText(error)}`);
      return false;
    }
  };

  /** 切换后的会话内提示；尚无 Live Agent 时暂存到首个 Agent 创建后补发。 */
  const notifyToggle = (sessionId, enabled) => {
    if (config.silent) return;
    const text = enabled ? NOTICE_ON : NOTICE_OFF;
    const agent = ctx.agents.get(sessionId);
    if (agent !== undefined) injectNotice(agent, text);
    else pendingNotices.set(String(sessionId), text);
  };

  // 已有 Agent 按当前模式初始化；之后的新 Agent 走 agent/created。
  for (const agent of ctx.agents.list()) applyAgent(agent);
  ctx.on('agent/created', ({ agent }) => {
    applyAgent(agent);
    const id = String(agent?.id ?? '');
    const notice = pendingNotices.get(id);
    if (notice !== undefined) {
      pendingNotices.delete(id);
      injectNotice(agent, notice);
    }
  });

  // 清理已销毁 Agent 的状态（section 随 agent 作用域自动回收）。
  ctx.on('agent/disposed', ({ agent }) => {
    const id = String(agent?.id ?? '');
    if (id === '') return;
    disposers.delete(id);
    agentStates.delete(id);
  });

  // 从模型回复里解析阶段锚点，供 /vibe-status 与规则注入使用；开关关闭时不跟踪。
  ctx.on('session/event', (session, event) => {
    try {
      const id = String(session?.id ?? '');
      if (!disposers.has(id)) return;
      trackStageFromEvent(session, event);
    } catch (error) {
      logger.debug(`stage tracking failed: ${errorText(error)}`);
    }
  });

  registerCommands(ctx, logger, config, {
    modeOf,
    isActive: (agentOrId) => disposers.has(String(agentOrId?.id ?? agentOrId ?? '')),
    setDelivery,
  });

  // ---------------- 可视化面板 / 输入框开关接口（Host 半） ----------------
  //
  // 所有接口同源、需携带 x-vibe-delivery-team: 1；状态完全来自会话内的
  // 阶段锚点、角色状态与产出物存在性，不额外落盘。
  const buildPanelState = (sessionId) => {
    const id = String(sessionId);
    const state = stateOf(id);
    const agent = ctx.agents.get(id);
    const cwd = agent?.session?.header?.cwd;
    const project = typeof cwd === 'string' && cwd !== '' ? detectProject(cwd) : undefined;
    const root = project?.root ?? (typeof cwd === 'string' && cwd !== '' ? cwd : undefined);
    const index = stageIndexOf(state.stage);
    const current = STAGES[index - 1];
    const absolute = (rel) => (root === undefined ? rel : join(root, rel));
    const present = (rel) => root !== undefined && pathExists(join(root, rel));

    const stages = STAGES.map((stage, i) => ({
      id: stage.id,
      name: stage.short,
      fullName: stage.name,
      status: i + 1 < index ? 'done' : i + 1 === index ? 'current' : 'pending',
    }));

    const roles = ROLES.map((role) => {
      const outputs = (current.outputs?.[role] ?? []).map((item) => ({
        name: item.name,
        path: item.path === undefined ? undefined : absolute(item.path),
        exists: item.path === undefined ? undefined : present(item.path),
      }));
      const isOwner = current.owner === role;
      const isParticipant = current.participants.includes(role);
      const doneEarlier = STAGES.slice(0, index - 1).some((stage) => stage.owner === role || stage.participants.includes(role));
      const pathOutputs = outputs.filter((item) => item.path !== undefined);
      const allExist = pathOutputs.length > 0 && pathOutputs.every((item) => item.exists === true);

      let status = 'idle';
      let task = '等待相关阶段启动';
      if (isOwner || isParticipant) {
        if (allExist) {
          status = 'review';
          task = `${current.name} 产出待评审`;
        } else if (isOwner) {
          status = 'active';
          task = `主导 ${current.name}`;
        } else {
          status = 'idle';
          task = `参与 ${current.name}（待启动）`;
        }
      } else if (doneEarlier) {
        status = 'done';
        task = '此前阶段职责已完成';
      }

      return { name: role, status, task, current: state.role === role, outputs };
    });

    return {
      ok: true,
      sessionId: id,
      enabled: sessionModes.get(id) === true || disposers.has(id),
      role: state.role,
      stage: {
        index,
        name: current.name,
        short: current.short,
        owner: current.owner,
        participants: current.participants,
        percent: Math.round(((index - 1) / STAGES.length) * 100),
        stages,
      },
      roles,
      details: {
        owner: current.owner,
        participants: current.participants,
        deliverables: current.deliverables.map((rel) => ({
          name: rel,
          path: absolute(rel),
          exists: present(rel),
        })),
        pendingQuestions: state.pendingQuestions ?? 0,
      },
      project: { detected: project !== undefined, root: root ?? null },
    };
  };

  ctx.inject(['webServer'], (uiCtx) => {
    hasUi = true;
    const webServer = uiCtx.webServer;
    // webServer 就绪后，按 UI 语义重新评估现存 Agent（Web 默认关闭）。
    for (const agent of ctx.agents.list()) applyAgent(agent);

    /** 同源请求校验。 */
    const guard = (request, response) => {
      if (request.headers[CLIENT_HEADER] === '1') return true;
      sendJson(response, 403, { ok: false, error: `forbidden: missing ${CLIENT_HEADER} header` });
      return false;
    };

    const handleModeRoute = async (request, response) => {
      if (!guard(request, response)) return;
      try {
        if (request.method === 'GET') {
          const sessionId = queryParam(request, 'sessionId');
          if (sessionId === undefined || sessionId === '') {
            sendJson(response, 400, { ok: false, error: 'sessionId required' });
            return;
          }
          sendJson(response, 200, {
            ok: true,
            sessionId,
            enabled: sessionModes.get(String(sessionId)) === true,
          });
          return;
        }

        if (request.method === 'POST') {
          const body = await readJsonBody(request);
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
          if (sessionId === '' || typeof body.enabled !== 'boolean') {
            sendJson(response, 400, { ok: false, error: 'sessionId and boolean enabled required' });
            return;
          }
          // UI 开关优先级最高：写入后立即对现存 Agent 注册/注销 section。
          sessionModes.set(sessionId, body.enabled);
          applySession(sessionId);
          notifyToggle(sessionId, body.enabled);
          sendJson(response, 200, { ok: true, sessionId, enabled: body.enabled });
          return;
        }

        sendJson(response, 405, { ok: false, error: 'method not allowed' });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: errorText(error) });
      }
    };

    /** 面板数据：阶段进度、角色矩阵、当前阶段详情。 */
    const handleStateRoute = async (request, response) => {
      if (!guard(request, response)) return;
      if (request.method !== 'GET') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        const sessionId = queryParam(request, 'sessionId');
        if (sessionId === undefined || sessionId === '') {
          sendJson(response, 400, { ok: false, error: 'sessionId required' });
          return;
        }
        sendJson(response, 200, buildPanelState(sessionId));
      } catch (error) {
        sendJson(response, 500, { ok: false, error: errorText(error) });
      }
    };

    /** 面板点击角色行：等效 /vibe-role 角色名。 */
    const handleRoleRoute = async (request, response) => {
      if (!guard(request, response)) return;
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        const role = typeof body.role === 'string' ? body.role : '';
        if (sessionId === '' || !ROLES.includes(role)) {
          sendJson(response, 400, { ok: false, error: `sessionId and one of ${ROLES.join('/')} required` });
          return;
        }
        stateOf(sessionId).role = role;
        sendJson(response, 200, { ok: true, sessionId, role });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: errorText(error) });
      }
    };

    /** 面板重置进度：等效 /vibe-reset（客户端负责二次确认）。 */
    const handleResetRoute = async (request, response) => {
      if (!guard(request, response)) return;
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        if (sessionId === '') {
          sendJson(response, 400, { ok: false, error: 'sessionId required' });
          return;
        }
        const state = stateOf(sessionId);
        state.stage = STAGES[0].name;
        state.role = ROLES[0];
        state.resetPending = false;
        state.pendingQuestions = 0;
        sendJson(response, 200, { ok: true, sessionId, state: buildPanelState(sessionId) });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: errorText(error) });
      }
    };

    /** 查看评审清单：以用户消息触发模型按固定 5 项输出。 */
    const handleReviewRoute = async (request, response) => {
      if (!guard(request, response)) return;
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        if (sessionId === '') {
          sendJson(response, 400, { ok: false, error: 'sessionId required' });
          return;
        }
        const agent = ctx.agents.get(sessionId);
        if (agent === undefined) {
          sendJson(response, 409, { ok: false, error: 'session agent is not live; send a message first' });
          return;
        }
        const state = stateOf(sessionId);
        agent.followup({
          id: randomUUID(),
          role: 'user',
          content: [{
            type: 'text',
            text: `请输出当前阶段（${state.stage}）的【阶段评审清单】，严格按固定 5 项：1. 交付物列表（附路径）2. 上一阶段对齐检查 3. P0 闭环检查 4. 风险与依赖 5. 待确认问题。`,
          }],
          source: { kind: 'user' },
        });
        sendJson(response, 200, { ok: true, sessionId });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: errorText(error) });
      }
    };

    /** 产出物文件打开：调用官方 sessionController.openWorkspacePath。 */
    const handleOpenRoute = async (request, response) => {
      if (!guard(request, response)) return;
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        const sessionController = uiCtx.get('sessionController');
        if (sessionController === undefined || sessionController === null || typeof sessionController.openWorkspacePath !== 'function') {
          sendJson(response, 501, { ok: false, error: 'file opening is not available on this host' });
          return;
        }
        const body = await readJsonBody(request);
        const path = typeof body.path === 'string' ? body.path : '';
        if (path === '') {
          sendJson(response, 400, { ok: false, error: 'path required' });
          return;
        }
        await sessionController.openWorkspacePath({ path }, new AbortController().signal);
        sendJson(response, 200, { ok: true, path });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: errorText(error) });
      }
    };

    uiCtx.effect(() => {
      const disposersList = [
        webServer.register({ kind: 'exact', path: MODE_PATH, handler: handleModeRoute }),
        webServer.register({ kind: 'exact', path: '/vibe-delivery-team/state', handler: handleStateRoute }),
        webServer.register({ kind: 'exact', path: '/vibe-delivery-team/role', handler: handleRoleRoute }),
        webServer.register({ kind: 'exact', path: '/vibe-delivery-team/reset', handler: handleResetRoute }),
        webServer.register({ kind: 'exact', path: '/vibe-delivery-team/review', handler: handleReviewRoute }),
        webServer.register({ kind: 'exact', path: '/vibe-delivery-team/open', handler: handleOpenRoute }),
      ];
      return () => {
        for (const dispose of disposersList) {
          try {
            dispose?.();
          } catch {
            // 路由注销失败不影响插件卸载。
          }
        }
      };
    });
  });
}
