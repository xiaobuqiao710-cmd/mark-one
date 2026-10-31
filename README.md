# 马克一号（Mark One）

> 一个装进 DeepSeek Harness 的**通用 super-agent 底座**：常驻路由器负责理解与分派，隔离的执行器负责长时间自主干活，二者共享一个文件黑板，Watchdog 负责把跑偏的活拽回来。

不是又一个「更聪明的 agent」，而是给 agent 换一套**组织方式**：把「对话」变成「工单」。

## 参考

本项目的设计不是凭空来的，它直接建立在两份材料上：

- **DeepSeek Harness 官方团队文章《Super-agent 设计探索：迈向更自主的 Agent 系统》** —— 提供四个设计目标（连续、高效、主动、持久）与五个核心模块（双层架构、事件驱动的任务流、面向人的交互层、计算状态与环境状态分离、Watchdog 机制）。本文是本项目的概念来源。
- **[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)** —— 同一团队的工程原型，提供领域模型 `Source → Trigger → Thread → Eval → Ticket → Mandate → Assignment`，以及「票据即上下文边界」的工程化取舍。本项目的代码结构以它为参照。

本仓库把它们落成一个可以直接装进 DSH 的 bundle：**一个主插件 + 三个 agent 预设 + 一个场景包**。

## 它解决什么问题

普通聊天式 agent 的两个结构性毛病：

1. **同一个上下文里既干推理又干苦力**：长任务把对话窗口撑爆，越干越糊涂，中途没法插话。
2. **没有"记住"和"主动"**：会话一结束，所有中间状态蒸发；没人盯着它，它就停在那儿等人问。

马克一号的答案是把这两件事拆开：

- 会思考的那层**常驻且轻**（Router），只理解、分派、合稿，不亲自干活；
- 干活的那层**隔离且可弃**（Worker），一个工单一个会话一个目录，脏活累活都在自己的上下文里烂掉；
- 两层之间**只通过文件说话**（黑板），不传对话历史。

## 架构

```
                 ┌─────────────── 人 ───────────────┐
                 │                                  │
        ┌────────▼─────────┐             ┌──────────▼─────────┐
        │  Router 常驻会话  │             │  Watchdog 巡检会话  │
        │  mark1-router    │             │  mark1-watchdog    │
        └────────┬─────────┘             └──────────┬─────────┘
                 │ mark1_dispatch                   │ 每 N 分钟看一次黑板
                 │ mark1_report  ← 汇报             │ 写 watchdog.md
     ┌───────────▼─────────────────────────────────▼───────────┐
     │              黑板（每个工单一个目录）                      │
     │  plan.md · sources.md · report.md · mark1-status.json    │
     └───────────┬─────────────────────────────────────────────┘
                 │ 一个工单 = 一个隔离会话（mark1-worker 预设）
        ┌────────▼────────┐   ┌─────────────────┐   ┌─────────────────┐
        │  Worker #1      │   │  Worker #2      │   │  Worker #3      │
        └─────────────────┘   └─────────────────┘   └─────────────────┘
```

四层职责：

| 层 | 预设 id | 干什么 | 不干什么 |
|---|---|---|---|
| 路由器 Router | `mark1-router` | 唯一与人对话；判断什么值得开工单；写好自足的 brief；合并结果；如实交代卡在哪 | 不亲自执行任务 |
| 执行器 Worker | `mark1-worker` | 在自己的会话与目录里干完一个自足任务，用 `mark1_report` 回报 | 不与人对话；不越界管别的工单 |
| 巡检 Watchdog | `mark1-watchdog` | 每隔 `watchdogMinutes` 分钟看一次黑板，判断有没有跑偏、有没有卡死 | 不改工单本身，只写 `watchdog.md` 留证 |
| 场景包 Scenes | — | 领域流程 + 交付骨架，按需装、按需挂 | 不进入核心，核心与领域无关 |

### 计算状态与环境状态分离

工单的一切**环境状态**（计划、来源、产物、状态）都在磁盘上：`plan.md` / `sources.md` / `report.md` / `mark1-status.json`（黑板常量见 `index.js` 的 `BLACKBOARD`）。会话只是**计算状态**，随时可以死；死了再开一个会话读黑板就能接着干。这就是「持久」的落地方式——不是靠更长的上下文，而是靠文件。

## 四个工具

装好之后会出现在工具列表里（`include:mark-one` 生效时）：

| 工具 | 输入 | 输出 | 用途 |
|---|---|---|---|
| `mark1_dispatch` | `brief`（必填，自足任务说明）、`title`（必填）、`scene?`、`workspace?` | `{ ticket, sessionId, directory, scene }` | 开一个后台 worker，立刻拿到会话 id，不阻塞 |
| `mark1_report` | `state`（`progress` / `ready` / `blocked` / `failed` / `dropped`）、`summary`、`files?`、`next?` | — | worker 向路由回报进度与结论 |
| `mark1_status` | — | 看板：活跃工单、场景、目录、最近一次回报、router / watchdog 会话 id | 随时问「现在在干什么」 |
| `mark1_wake_ticket` | `ticket` + `message` | — | 人中途插话：不重开上下文，往既有工单里补一句 |

设计上的几个硬约束（写在代码里，不是约定）：

- 并发上限 `maxTickets`（默认 6），超了直接报错而不是排队——排队会让人以为活已经开始了。
- brief 必须自足：worker 看不到路由器的对话，`composeWorkerBrief()` 会把任务说明、场景情境、黑板目录一起写进 `plan.md` 并投递。
- 主动续推有预算：`proactiveRounds`（默认 12），防止 agent 自我加速跑飞。
- Watchdog 只读黑板 + 写 `watchdog.md`，失败是 best-effort，不影响主流程。

## 安装

这是一个 DSH bundle（`@local/dsh-mark-one-v5`），在 desktop profile 里以 `link:` 方式挂载即可，改完不用重装：

```bash
# 1. 把 bundle 链进 profile
cd ~/.dsh/profiles/desktop
pnpm add "link:/Users/xianlinglong/Desktop/图鲲/mark1"

# 2. 在 profile 的 package.json 里登记到 dsh.profile.bundles
#    "dsh": { "profile": { "bundles": [ ..., "@local/dsh-mark-one-v5" ] } }

# 3. 重启 DSH Desktop
```

`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，patch 里一次性插入 `mark-one` 插件与三个 agent 预设。

## 验证

装完（并重启应用）后，用这三件事确认它真的活着——不需要看 UI：

1. **工具在位**：工具列表里出现 `mark1_dispatch` / `mark1_report` / `mark1_status` / `mark1_wake_ticket`；调用 `mark1_status` 返回 `Mark One board is empty.`
2. **场景包生效**：可用技能目录里多出 `mark1-research`（由 `scenes.js` 在 `agent/created` 时挂到每个 agent 的 ctx 上）。
3. **预设无 broken**：预设面板里「马克一号 · 路由 / 执行 / 巡检」三条都在，无红色 broken 标记。

不重启也能查的两条离线口径：

```bash
# 插件入口能否被求值（ESM 顶层 import 炸掉时 host 只报 "1 entry did not activate"）
node --check index.js && node --input-type=module -e "import('./index.js').then(m=>console.log(Object.keys(m)))"

# 预设配置是否满足 zod schema
# 用 @deepseek-ai/dsh-agent-preset 的 Config 校验 cordis.patch.yml 里三条预设的 config
```

> 踩坑记录：`index.js` 顶部曾有一条指向 `./internals.js` 的坏 import（该文件不存在），结果是**整个插件入口 import 失败**——host 只打一行 `1 entry did not activate`，四个工具全部消失，且 ESM 模块缓存按真实路径为键、不会重试。排障认准这条：工具全没了先看入口能不能 `import`。

## 目录

```
mark1/
├── index.js                  # 插件主体（611 行）：Router/Worker/Watchdog 三个预设 + 四个工具 + 黑板
├── scenes.js                 # 场景包注入：把 skills/<id>/SKILL.md 注册成运行时技能
├── cordis.patch.yml          # bundle 补丁：insert mark-one + 三条 agent-preset（order 30/31/32）
├── skills/
│   └── mark1-research/       # 首个场景包：课题研究报告（定界→取证→搭框架→带来源的稿子）
│       └── SKILL.md
├── locale/{zh,en}.json       # meta.title / meta.description
├── icon.svg
└── internals/
    └── acp.mjs               # 排查用探针（当前无引用，保留备用）
```

## 配置

`mark-one` 插件在 `cordis.patch.yml` 里的默认值：

| 键 | 默认 | 含义 |
|---|---|---|
| `maxTickets` | `6` | 单个路由器同时活跃的最大工单数 |
| `proactiveRounds` | `12` | 主动续推轮数预算 |
| `watchdogMinutes` | `30` | 巡检间隔；`0` 关闭 Watchdog |
| `scenes` | `[mark1-research]` | 装载的场景包（正文真源在 `skills/<id>/SKILL.md`） |

`stateDir` 默认 `~/.dsh/state/mark1`，黑板与工单目录都落在这里。

## 场景包：把领域流程从核心里摘出去

核心（路由 / 执行 / 黑板 / 巡检）不知道「研究报告」是什么。领域知识全在 `skills/<id>/SKILL.md` 里，可以被编辑、替换、并装多个。首个场景包 `mark1-research`（课题研究报告）：

- **触发**：在路由器会话里说「研究 <课题>」或「给 <课题> 出报告」。
- **拆法**：默认拆成「文献与资料」「现有材料」「框架与结论」三类，第三类依赖前两类，不盲目并行。
- **验收**：可溯源 + 说清了不确定性，而不是字数。
- **产物**：`outline.md` / `sources.md` / `report.md` / `report.html`，落在该工单目录下。

加一个新场景 = 新建 `skills/<new-id>/SKILL.md` + 在 `cordis.patch.yml` 的 `scenes` 里加一行。核心代码不动。

## 已知限制

- `internals/acp.mjs` 是排查用的空探针壳，当前无引用；不影响加载。
- 三个 agent 预设的「无 broken」以 UI 面板为准，没有 programmatic 查询接口；离线只能做到 zod schema 校验 + patch 装配校验（`loadProfileDirectory`）。
- 场景包目前只有一个，多场景并发时的黑板隔离策略还没经过真实压测。
