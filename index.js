/**
 * 马克一号（Mark One）· 通用 super-agent 底座
 *
 * 设计骨架来自两条线：
 *   - 《Super-agent 设计探索》的四特征（连续 / 高效 / 主动 / 持久）与五模块
 *     （双层架构 · 事件驱动 · 面向人的交互 · 计算状态环境分离 · Watchdog）；
 *   - `dsh-superagent-prototype` 的 Source→Trigger→Thread→Eval→Ticket→Mandate→
 *     Assignment 域模型（这里做了领域无关的裁剪）。
 *
 * 本插件只做「能让这套东西真正跑起来」的薄层，不重写 DSH：
 *
 *   1. 常驻 Router 会话（`mark1-router`）：唯一与人对话、唯一有权派活的手。
 *   2. Worker 会话（`mark1-<ticket>`）：每个人一件事，独立 workspace、独立上下文、
 *      可续航；它不直接找人，只能 `mark1_report` 回来。
 *   3. 黑板（Blackboard / Files）：计算、状态、环境分离的落地形态 —— Router 与
 *      Worker 之间不共享上下文，只共享 ticket 目录里的文件。
 *   4. 主动（Proactive）：Router 结束一轮时，插件读黑板上的「等待中」状态并唤醒
 *      Router 继续推进，人不用一直戳。
 *   5. Watchdog：定时回路巡检，读黑板判断 Worker 有没有跑偏，把异议写回目录。
 *
 * 所有领域能力（研究报告、代码、调研……）都以「场景包」形式挂在 config.scenes 里，
 * 核心 persona 不含任何具体领域的流程。
 *
 * 依赖约定：本插件只 import node 内置模块。DSH 的宿主包（schemastery / dsh-llm /
 * dsh-tools）**不从本包 import**，因为工作区包在 Node 解析下拿不到 profile 的
 * node_modules；能力全部从注入的 ctx 服务上取。
 *
 * @module @local/dsh-mark-one
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { mountScenes } from './scenes.js'

/** Stable Loader identity. */
export const name = 'dsh-mark-one'

/** Services this plugin consumes. */
export const inject = ['tools', 'systemPrompt', 'sessionController', 'connection']

/** Router / Worker / Watchdog 三个预设 id（与 cordis.patch.yml 保持一致）。 */
const ROUTER_PRESET = 'mark1-router'
const WORKER_PRESET = 'mark1-worker'
const WATCHDOG_PRESET = 'mark1-watchdog'

/** 常驻会话 id。 */
const ROUTER_SESSION = 'mark1-router'
const WATCHDOG_SESSION = 'mark1-watchdog'

/** 场景包目录（与 SKILL.md 同级，随包分发）。 */
const SCENES_DIR = fileURLToPath(new URL('./skills/', import.meta.url))

/** 黑板文件名。 */
const BLACKBOARD = {
  plan: 'plan.md',
  sources: 'sources.md',
  report: 'report.md',
  status: 'mark1-status.json'
}

/** 浏览器端看板的数据接口（精确 Fetch 路由，只有 owner 能调）。 */
const UI_ROUTE = '/api/mark1'

/** 看板一次最多读多少字黑板文件；超出截断并标记。 */
const BOARD_TEXT_LIMIT = 24_000

/** 默认值；config 里的同名字段覆盖。 */
const DEFAULTS = {
  maxTickets: 6,
  proactiveRounds: 12,
  watchdogMinutes: 30
}

/**
 * 解析插件配置。不依赖 schemastery：只挑认识的键，其余忽略。
 * @param config - Raw loader config.
 * @returns normalized config.
 */
function normalizeConfig(config) {
  const raw = config ?? {}
  return {
    stateDir: typeof raw.stateDir === 'string' && raw.stateDir.length > 0
      ? raw.stateDir
      : join(homedir(), '.dsh', 'state', 'mark1'),
    maxTickets: Number.isFinite(raw.maxTickets) ? raw.maxTickets : DEFAULTS.maxTickets,
    proactiveRounds: Number.isFinite(raw.proactiveRounds) ? raw.proactiveRounds : DEFAULTS.proactiveRounds,
    watchdogMinutes: Number.isFinite(raw.watchdogMinutes) ? raw.watchdogMinutes : DEFAULTS.watchdogMinutes,
    scenes: Array.isArray(raw.scenes) ? raw.scenes : []
  }
}

/**
 * Read an optional service from a context without tripping the inject guard.
 * @param ctx - Any context (plugin or agent scope).
 * @param name - Service name.
 * @returns the service instance, or undefined when the context does not expose it.
 */
function optionalService(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return void 0
  }
}

/**
 * Long-lived interval without depending on the host `timer` service.
 * DSH's own cron/schedule facilities all target the calling agent session, and a
 * plugin-owned `setInterval` is cleared by `dispose()` so nothing leaks on unload.
 */
function wallClock(ctx, ms, tick) {
  const handle = setInterval(tick, ms)
  if (typeof handle?.unref === 'function') handle.unref()
  return () => clearInterval(handle)
}


/**
 * Build a user message. Prefers the host factory when reachable so ids and
 * freezing match DSH expectations; falls back to a plain object.
 * @param ctx - Context used to reach dsh-llm.
 * @param text - Message body.
 * @param kind - MessageSourceMap kind.
 * @returns a user message value.
 */
function makeUserMessage(ctx, text, kind = 'user') {
  const llm = optionalService(ctx, 'llm')
  const content = [{ type: 'text', text }]
  const options = { content, source: { kind } }
  if (kind === 'schedule') options.title = '马克一号'
  if (llm !== void 0 && typeof llm.createUserMessage === 'function') {
    try {
      return llm.createUserMessage(options)
    } catch {
      /* fall back below */
    }
  }
  return { id: randomUUID(), role: 'user', content, ...(options.title === void 0 ? {} : { title: options.title }), source: { kind } }
}

/**
 * Plugin entry.
 * @param ctx - Host context.
 * @param rawConfig - Loader config (see DEFAULTS).
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const sceneById = new Map()
  for (const scene of config.scenes) {
    if (typeof scene?.id === 'string' && scene.id.length > 0) sceneById.set(scene.id, scene)
  }

  /** Shared runtime state; owned by this plugin fiber. */
  const runtime = {
    tickets: [],
    routerSessionId: ROUTER_SESSION,
    proactiveBudget: new Map(),
    persist: async () => {
      await mkdir(config.stateDir, { recursive: true })
      const rows = runtime.tickets.map((t) => ({ ...t }))
      await writeFile(join(config.stateDir, 'tickets.json'), `${JSON.stringify({ version: 1, tickets: rows }, null, 2)}\n`, 'utf8')
    },
    load: async () => {
      try {
        const text = await readFile(join(config.stateDir, 'tickets.json'), 'utf8')
        const raw = JSON.parse(text)
        if (Array.isArray(raw.tickets)) runtime.tickets = raw.tickets
      } catch {
        /* first run */
      }
    }
  }

  ctx.effect(() => () => {
    runtime.proactiveBudget.clear()
  }, 'mark1.runtime')

  // 场景包 → 每个 agent 技能层上的运行时技能（正文来自 skills/<id>/SKILL.md）。
  mountScenes(ctx, config.scenes, SCENES_DIR)

  // Router persona 末尾补上「装了哪些场景包」。
  const scenesText = renderScenes(config.scenes)
  if (scenesText.length > 0) {
    ctx.effect(() => ctx.systemPrompt.variable('mark1_scenes', () => scenesText), 'mark1.scenes-var')
  }

  registerTools(ctx, config, runtime)
  registerUiRoute(ctx, config, runtime)

  ctx.effect(() => {
    void runtime.load()
  }, 'mark1.load')

  // 主动模式：Router 每次回到 idle，就看看黑板上还有没有等待项。
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    if (agent.session.id !== (runtime.routerSessionId ?? ROUTER_SESSION)) return
    void maybeContinue(ctx, config, runtime, agent)
  })

  // Watchdog：定时回路，与 Router 上下文完全隔离。
  // 用插件自己的 setInterval（随 fiber 卸载自动清理），不依赖宿主 timer 服务：
  // 每次 tick 只做一件事——若黑板上有活跃票据，就把巡检提示投递给 watchdog 会话。
  if (config.watchdogMinutes > 0) {
    ctx.effect(() => wallClock(ctx, config.watchdogMinutes * 60_000, () => {
      void wakeWatchdog(ctx, config, runtime)
    }), 'mark1.watchdog')
  }
}

/**
 * Register the Mark One tools.
 * @param ctx - Context owning `tools` and `sessionController`.
 * @param config - Normalized config.
 * @param runtime - Shared runtime state.
 */
function registerTools(ctx, config, runtime) {
  const scenes = config.scenes
  const sceneById = new Map(scenes.filter((s) => typeof s?.id === 'string').map((s) => [s.id, s]))

  ctx.tools.register({
    name: 'mark1_dispatch',
    description: [
      'Start one background worker for a self-contained task and get its session id back immediately.',
      'The worker runs in its own session with its own workspace directory; it cannot talk to the user, it reports through `mark1_report`.',
      'Give it a brief that stands alone: the goal, what "done" looks like, the scene id (if any), and the ticket directory.',
      'After dispatching, keep working on independent steps; do not sleep or poll. Its report arrives as a message.'
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['brief', 'title'],
      properties: {
        brief: { type: 'string', description: 'The full task brief for the worker. Standalone; it does not see this conversation.' },
        title: { type: 'string', description: 'Short human-readable name for the ticket (used in the directory and the session title).' },
        scene: { type: 'string', description: `Scene id this task belongs to. One of: ${scenes.map((s) => s.id).join(', ') || '(none installed)'}. Omit for a general task.` },
        workspace: { type: 'string', description: 'Existing absolute directory to work in. Defaults to a fresh directory under the Mark One state dir.' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ticket: { type: 'string' },
          sessionId: { type: 'string' },
          directory: { type: 'string' },
          scene: { type: 'string' }
        }
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Dispatched ${value.ticket} as session ${value.sessionId} in ${value.directory}.`
      }]
    },
    async execute(args, exec) {
      const caller = exec.agent
      if (caller === void 0) throw new Error('mark1_dispatch requires an owning agent session')
      if (args.scene !== void 0 && !sceneById.has(args.scene)) {
        throw new Error(`unknown scene "${args.scene}"; installed: ${[...sceneById.keys()].join(', ') || '(none)'}`)
      }
      const live = runtime.tickets.filter((t) => t.router === caller.session.id && t.state === 'active')
      if (live.length >= config.maxTickets) {
        throw new Error(`mark1_dispatch limit reached (${config.maxTickets} active tickets). Wait for a report before starting more.`)
      }
      const scene = args.scene === void 0 ? void 0 : sceneById.get(args.scene)
      const ticket = mkId('mk', `${caller.session.id}:${args.title}`)
      const dir = args.workspace === void 0
        ? join(config.stateDir, 'tickets', ticket)
        : resolve(args.workspace)
      await mkdir(dir, { recursive: true })

      const brief = composeWorkerBrief({ ticket, title: args.title, brief: args.brief, scene, dir })
      await writeFile(join(dir, BLACKBOARD.plan), brief, 'utf8')

      const created = await ctx.sessionController.create({
        sessionId: `mark1-${ticket}`,
        cwd: dir,
        agentPreset: WORKER_PRESET
      })
      runtime.tickets.push({
        ticket,
        title: args.title,
        sessionId: created.sessionId,
        directory: dir,
        scene: args.scene,
        router: caller.session.id,
        state: 'active',
        createdAt: nowIso(),
        lastReport: void 0
      })
      await runtime.persist()

      await ctx.sessionController.rename?.({ sessionId: created.sessionId, title: `马克一号 · ${args.title}` }).catch(() => {})
      await kick(ctx, created.sessionId, `# 任务 ${ticket}\n\n${brief}`)
      return { ticket, sessionId: created.sessionId, directory: dir, ...(args.scene === void 0 ? {} : { scene: args.scene }) }
    }
  })

  ctx.tools.register({
    name: 'mark1_report',
    description: [
      'Report the outcome of this ticket back to the router session.',
      'Call it when the work is finished, when it is blocked on a concrete missing precondition, or when you are dropping it as out of scope.',
      'The report must say what exists now (file paths), what was verified, and what is left.'
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'summary'],
      properties: {
        state: { type: 'string', enum: ['progress', 'ready', 'blocked', 'failed', 'dropped'], description: 'progress = still working on it; ready = deliverable exists; blocked = a concrete precondition is missing; failed = tried and could not; dropped = out of scope.' },
        summary: { type: 'string', description: 'What happened, in a few sentences.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Paths of deliverables that now exist.' },
        next: { type: 'string', description: 'What should happen next, if anything.' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ticket: { type: 'string' },
          state: { type: 'string' },
          delivered: { type: 'boolean' }
        }
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.delivered
          ? `Reported ${value.ticket} to the router as ${value.state}.`
          : 'No active ticket owns this session; nothing was reported.'
      }]
    },
    async execute(args, exec) {
      const caller = exec.agent
      if (caller === void 0) throw new Error('mark1_report requires an owning agent session')
      const ticket = runtime.tickets.find((t) => t.sessionId === caller.session.id)
      if (ticket === void 0) return { ticket: '-', state: args.state, delivered: false }
      ticket.lastReport = { state: args.state, summary: args.summary, files: args.files ?? [], next: args.next, at: nowIso() }
      if (args.state !== 'progress') ticket.state = args.state
      await runtime.persist()
      await mkdir(ticket.directory, { recursive: true })
      await writeFile(
        join(ticket.directory, BLACKBOARD.status),
        `${JSON.stringify(ticket.lastReport, null, 2)}\n`,
        'utf8'
      ).catch(() => {})

      const router = await resolveAgent(ctx, ticket.router)
      if (router !== void 0) {
        const files = (args.files ?? []).length > 0 ? `\n交付物：\n${args.files.map((f) => `- ${f}`).join('\n')}` : ''
        const next = args.next ? `\n下一步：${args.next}` : ''
        await deliver(ctx, router, `## ${ticket.title}（${ticket.ticket}）报告：${args.state}\n\n${args.summary}${files}${next}`)
      }
      return { ticket: ticket.ticket, state: args.state, delivered: router !== void 0 }
    }
  })

  ctx.tools.register({
    name: 'mark1_status',
    description: 'Read the Mark One board: active tickets, their scene, directory, last report, and the router/watchdog session ids.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.tickets.length === 0
          ? 'Mark One board is empty.'
          : value.tickets.map((t) => `- ${t.ticket} [${t.state}] ${t.title} → ${t.directory}${t.lastReport === void 0 ? '' : ` · ${t.lastReport.state}: ${String(t.lastReport.summary).slice(0, 120)}`}`).join('\n')
      }]
    },
    async execute() {
      return {
        router: runtime.routerSessionId ?? ROUTER_SESSION,
        watchdog: config.watchdogMinutes > 0 ? WATCHDOG_SESSION : void 0,
        stateDir: config.stateDir,
        scenes: scenes.map((s) => ({ id: s.id, name: s.name })),
        tickets: runtime.tickets.map((t) => ({ ...t }))
      }
    }
  })

  ctx.tools.register({
    name: 'mark1_wake_ticket',
    description: [
      'Send a follow-up message to an existing worker session and wake it.',
      'Use it to unblock a worker, add a constraint, or continue a finished ticket with new information.',
      'The session is resumed on demand, so this works after a restart.'
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['ticket', 'message'],
      properties: {
        ticket: { type: 'string', description: 'Ticket id or session id.' },
        message: { type: 'string', description: 'The message to deliver.' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ticket: { type: 'string' }, sessionId: { type: 'string' }, woken: { type: 'boolean' } }
      },
      render: (_args, value) => [{ type: 'text', text: value.woken ? `Woke ${value.ticket} (${value.sessionId}).` : `Could not resolve ${value.ticket}.` }]
    },
    async execute(args) {
      const ticket = runtime.tickets.find((t) => t.ticket === args.ticket || t.sessionId === args.ticket)
      const sessionId = ticket?.sessionId ?? args.ticket
      const agent = await resolveAgent(ctx, sessionId)
      if (agent === void 0) return { ticket: args.ticket, sessionId, woken: false }
      if (ticket !== void 0) {
        ticket.state = 'active'
        ticket.lastReport = void 0
        await runtime.persist()
      }
      await kick(ctx, sessionId, args.message)
      return { ticket: ticket?.ticket ?? args.ticket, sessionId, woken: true }
    }
  })
}

/**
 * 浏览器端看板的数据通道：一条精确 Fetch 路由 `/api/mark1`。
 *
 * 为什么用 `connection.fetch` 而不是 typert RPC：宿主只把这个精确路由交给 owner
 * 会话（非 owner 403），而我们需要的全部是「读工单表 / 读黑板文件 / 把一句话投给
 * 某个会话」，没有一份需要生成的类型契约。ds-bot 走的是同一条路。
 *
 * 信封照 ds-bot：`{ ok: true, value }` | `{ ok: false, error: { code, message, details } }`。
 * 注册必须包在 `ctx.effect` 里 —— 精确路由重复注册会直接抛错，而这个插件是
 * `patchReload: live` 的。
 *
 * @param ctx - Context owning `connection` and `sessionController`.
 * @param config - Normalized config.
 * @param runtime - Shared runtime state.
 */
function registerUiRoute(ctx, config, runtime) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: UI_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return json(uiFail('mark1/bad-json', 'request body is not JSON'))
      }
      try {
        const value = await serveUi(ctx, config, runtime, body?.endpoint, body?.payload ?? null)
        return json({ ok: true, value })
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'mark1/error'
        return json(uiFail(code, error instanceof Error ? error.message : String(error)))
      }
    }
  }), 'mark1.ui-route')
}

/**
 * 分派一个看板端点。
 * @param ctx - Owning context.
 * @param config - Normalized config.
 * @param runtime - Shared runtime state.
 * @param endpoint - Endpoint name from the browser.
 * @param payload - Endpoint payload.
 * @returns the envelope value.
 */
async function serveUi(ctx, config, runtime, endpoint, payload) {
  switch (endpoint) {
    case 'board':
      return boardSnapshot(config, runtime, payload?.sessionId)
    case 'file':
      return readBlackboard(config, runtime, payload?.ticket, payload?.file)
    case 'wake': {
      const ticket = findTicket(runtime, payload?.ticket)
      const agent = await resolveAgent(ctx, ticket.sessionId)
      if (agent === void 0) throw fail('mark1/not-found', `会话 ${ticket.sessionId} 不在线，无法唤醒`)
      ticket.state = 'active'
      ticket.lastReport = void 0
      ticket.wokenAt = nowIso()
      await runtime.persist()
      await kick(ctx, ticket.sessionId, String(payload?.message ?? '').trim() || '继续。')
      return { ticket: ticket.ticket, state: ticket.state }
    }
    case 'stop': {
      const ticket = findTicket(runtime, payload?.ticket)
      await ctx.sessionController.cancel({ sessionId: ticket.sessionId })
      ticket.state = 'blocked'
      ticket.stoppedAt = nowIso()
      ticket.lastReport = {
        state: 'blocked',
        summary: '从看板上手动停止。',
        files: [],
        next: void 0,
        at: nowIso(),
        by: 'board'
      }
      await runtime.persist()
      const router = await resolveAgent(ctx, ticket.router)
      if (router !== void 0) {
        await deliver(ctx, router, `## ${ticket.title}（${ticket.ticket}）：已从看板停止\n\nWorker 会话 ${ticket.sessionId} 已取消。需要继续就在看板上「追加指令」，或派新工单。`)
      }
      return { ticket: ticket.ticket, state: ticket.state }
    }
    case 'rename': {
      const ticket = findTicket(runtime, payload?.ticket)
      const title = String(payload?.title ?? '').trim()
      if (title.length === 0) throw fail('mark1/bad-request', '标题不能为空')
      ticket.title = title
      await runtime.persist()
      try {
        await ctx.sessionController.rename({ sessionId: ticket.sessionId, title: `马克一号 · ${title}` })
      } catch {
        /* 会话不在线时改本地标题就够 */
      }
      return { ticket: ticket.ticket, title }
    }
    default:
      throw fail('mark1/unknown-endpoint', `未知端点：${String(endpoint)}`)
  }
}

/**
 * 看板快照。只读 runtime，不碰磁盘（tickets.json 已经 load 进内存）。
 * @param config - Normalized config.
 * @param runtime - Shared runtime state.
 * @param sessionId - 看板所在会话；用来标出「本会话是路由」。
 * @returns the board value.
 */
function boardSnapshot(config, runtime, sessionId) {
  const router = runtime.routerSessionId ?? ROUTER_SESSION
  return {
    router,
    routerActive: sessionId === router,
    watchdog: config.watchdogMinutes > 0 ? WATCHDOG_SESSION : void 0,
    stateDir: config.stateDir,
    maxTickets: config.maxTickets,
    watchdogMinutes: config.watchdogMinutes,
    scenes: config.scenes.map((s) => ({ id: s.id, name: s.name, description: s.description })),
    tickets: runtime.tickets.map((t) => ({
      ticket: t.ticket,
      title: t.title,
      state: t.state,
      scene: t.scene,
      sessionId: t.sessionId,
      router: t.router,
      directory: t.directory,
      createdAt: t.createdAt,
      lastReport: t.lastReport
    }))
  }
}

/**
 * 读一张工单目录里的黑板文件。
 * @param config - Normalized config.
 * @param runtime - Shared runtime state.
 * @param ticketId - Ticket id or session id.
 * @param name - Blackboard file name.
 * @returns `{ file, text, truncated }`.
 */
async function readBlackboard(config, runtime, ticketId, name) {
  const ticket = findTicket(runtime, ticketId)
  const allowed = Object.values(BLACKBOARD)
  if (!allowed.includes(name)) throw fail('mark1/bad-request', `只能读 ${allowed.join(' / ')}`)
  const path = join(ticket.directory, name)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { file: name, text: '', truncated: false }
  }
  const truncated = text.length > BOARD_TEXT_LIMIT
  return { file: name, text: truncated ? text.slice(0, BOARD_TEXT_LIMIT) : text, truncated }
}

/**
 * 按 ticket id 或 session id 找工单。
 * @param runtime - Shared runtime state.
 * @param id - Ticket or session id.
 * @returns the ticket.
 */
function findTicket(runtime, id) {
  const ticket = runtime.tickets.find((t) => t.ticket === id || t.sessionId === id)
  if (ticket === void 0) throw fail('mark1/not-found', `找不到工单：${String(id)}`)
  return ticket
}

/**
 * 造一个带 code 的错误，供信封使用。
 * @param code - Machine code.
 * @param message - Human message.
 * @returns an Error carrying `code`.
 */
function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * 失败信封。
 * @param code - Machine code.
 * @param message - Human message.
 * @returns the envelope.
 */
function uiFail(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

/**
 * JSON 响应。
 * @param value - Envelope.
 * @returns a Response.
 */
function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

/**
 * Deliver one user message to a session and wake it.
 * @param ctx - Context owning the session controller.
 * @param sessionId - Target session.
 * @param text - Message body.
 */
async function kick(ctx, sessionId, text) {
  const agent = await resolveAgent(ctx, sessionId)
  if (agent === void 0) throw new Error(`mark1: session "${sessionId}" is not reachable`)
  await deliver(ctx, agent, text)
}

/**
 * Wake an agent with one user message.
 * @param ctx - Owning context.
 * @param agent - Exact live agent.
 * @param text - Message body.
 */
async function deliver(ctx, agent, text) {
  await agent.followup(makeUserMessage(ctx, text, 'user'))
  await optionalService(ctx, 'sessions')?.flush?.(agent.session)
}

/**
 * Resolve a session id to its live agent, resuming a sleeping session.
 * @param ctx - Owning context.
 * @param sessionId - Target session.
 * @returns the live agent, or undefined when it cannot be resumed.
 */
async function resolveAgent(ctx, sessionId) {
  try {
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    return resolved?.agent
  } catch {
    return void 0
  }
}

/**
 * Compose the worker brief written to `plan.md`.
 * @param input - Ticket facts.
 * @returns markdown brief.
 */
function composeWorkerBrief({ ticket, title, brief, scene, dir }) {
  const lines = [
    `# ${title}`,
    '',
    `- 票据：${ticket}`,
    `- 工作目录：${dir}`,
    scene === void 0 ? undefined : `- 场景包：${scene.id}（${scene.name}）`,
    '',
    '## 任务',
    '',
    String(brief ?? '').trim(),
    ''
  ].filter((line) => line !== undefined)
  if (scene !== void 0) {
    if (typeof scene.workerNote === 'string' && scene.workerNote.length > 0) {
      lines.push('## 场景要求', '', scene.workerNote.trim(), '')
    }
    if (typeof scene.skeleton === 'string' && scene.skeleton.length > 0) {
      lines.push('## 交付骨架', '', scene.skeleton.trim(), '')
    }
  }
  lines.push(
    '## 工作方式',
    '',
    '- 先把这个文件读一遍再动手；`plan.md` 是你和 Router 唯一的共享契约。',
    '- 证据（链接、文件路径、数据）实时写进 `sources.md`，不要等到最后。',
    '- 交付物写进本目录；有报告就落 `report.md`。',
    '- 做完或卡住都调 `mark1_report`：ready / blocked / failed / dropped 必须说清剩下什么。',
    '- 不要找人对话；你只对 Router 负责。'
  )
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * Compose the watchdog prompt.
 * @param config - Normalized config.
 * @param runtime - Shared runtime state.
 * @returns prompt text.
 */
function composeWatchdogPrompt(config, runtime) {
  const active = runtime.tickets.filter((t) => t.state === 'active')
  return [
    '# 巡检',
    '',
    `当前活跃票据 ${active.length} 个：`,
    ...active.map((t) => `- ${t.ticket} ${t.title} → ${t.directory}`),
    '',
    '逐个读目录里的 `plan.md` / `mark1-status.json` / `sources.md`，只回答一个问题：**这个 Worker 有没有偏离 plan.md 定下的目标**。',
    '把结论写进对应目录的 `watchdog.md`（时间 + 判断 + 依据 + 建议动作）。',
    '发现明确跑偏的，用一句话写清哪个票据、偏在哪里。什么都没发现就正常结束，不要制造噪音。'
  ].join('\n')
}

/**
 * Proactive continuation: when the router goes idle with active tickets left,
 * hand it a nudge built from the blackboard.
 * @param ctx - Host context.
 * @param config - Normalized config.
 * @param runtime - Shared runtime state.
 * @param agent - The router agent that just went idle.
 */
async function maybeContinue(ctx, config, runtime, agent) {
  const active = runtime.tickets.filter((t) => t.router === agent.session.id && t.state === 'active')
  if (active.length === 0) return
  const used = runtime.proactiveBudget.get(agent.session.id) ?? 0
  if (used >= config.proactiveRounds) return
  runtime.proactiveBudget.set(agent.session.id, used + 1)
  const lines = active.map((t) => `- ${t.ticket} ${t.title} → ${t.directory}${t.lastReport === void 0 ? '' : `（${t.lastReport.state}）`}`)
  const text = [
    '# 主动推进',
    '',
    '你之前派出去的活还没收口：',
    ...lines,
    '',
    '读它们目录里的 `plan.md` / `sources.md` / `mark1-status.json`，判断现在能不能合稿、要不要补派一手。',
    '全部收口了就正常结束，不要再排新的活。没有可推进的也直接结束回合。'
  ].join('\n')
  await agent.followup(makeUserMessage(ctx, text, 'user'))
  await optionalService(ctx, 'sessions')?.flush?.(agent.session)
}

/**
 * Let the watchdog session run one inspection round.
 * @param ctx - Host context.
 * @param config - Normalized config.
 * @param runtime - Shared runtime state.
 */
async function wakeWatchdog(ctx, config, runtime) {
  const active = runtime.tickets.filter((t) => t.state === 'active')
  if (active.length === 0) return
  const prompt = composeWatchdogPrompt(config, runtime)
  const agent = await resolveAgent(ctx, WATCHDOG_SESSION)
  if (agent !== void 0) {
    await agent.followup(makeUserMessage(ctx, prompt, 'schedule'))
    await optionalService(ctx, 'sessions')?.flush?.(agent.session)
    return
  }
  try {
    await ctx.sessionController.create({
      sessionId: WATCHDOG_SESSION,
      cwd: join(config.stateDir, 'watchdog'),
      agentPreset: WATCHDOG_PRESET
    })
    await kick(ctx, WATCHDOG_SESSION, prompt)
  } catch {
    /* watchdog is best-effort */
  }
}

/**
 * Render the installed scenes for the router persona.
 * @param scenes - Config scenes.
 * @returns markdown block, or an empty string.
 */
function renderScenes(scenes) {
  if (!Array.isArray(scenes) || scenes.length === 0) return ''
  const rows = scenes.map((s) => {
    const trigger = typeof s.trigger === 'string' && s.trigger.length > 0 ? ` 触发：${s.trigger}` : ''
    const brief = typeof s.brief === 'string' && s.brief.length > 0 ? ` ${s.brief}` : ''
    return `- \`${s.id}\`（${s.name}）：${String(brief).trim()}${trigger}`.trim()
  })
  return `## 已装场景包\n${rows.join('\n')}\n\n场景包只提供领域知识（怎么调研、怎么取证、交付什么骨架）。它不改变下面的路由规则。`
}

/**
 * Skill name check (DSH reserves `^[a-z0-9]+(?:-[a-z0-9]+)*$`).
 * @param value - Candidate name.
 * @returns whether the name is a legal skill id.
 */
function skillNameOk(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

/**
 * Deterministic short id.
 * @param prefix - Id prefix.
 * @param seed - Stable seed material.
 * @returns `${prefix}-<8 hex>`.
 */
function mkId(prefix, seed) {
  return `${prefix}-${createHash('sha1').update(seed).digest('hex').slice(0, 8)}`
}

/** @returns ISO timestamp. */
function nowIso() {
  return new Date().toISOString()
}
