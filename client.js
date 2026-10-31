/* 由 scripts/build-client.mjs 生成，不要手改；改 src/client/ 后重新运行 npm run build。 */
window.__ModuleLoader__.load({
	id: "@local/dsh-mark-one-v5",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/** 内部模块表：按需执行一次，结果缓存。 */
		var __defs = {
"board": (module, exports, __m) => {
/**
 * 马克一号 · 右栏整页看板。
 *
 * 这一屏是「人看这套 super-agent 在干什么」的唯一界面：
 *   · 顶部：路由会话 / 看门狗会话 / 场景包数量 / 活跃票据数，可一键跳过去对话；
 *   · 主体：工单卡片（状态、场景、最近报告、交付物、黑板文件、操作）；
 *   · 折叠：场景包清单、黑板 plan.md 原文。
 *
 * 数据全部走 `/api/mark1`（见 rpc.js），每 3 秒静默轮询一次，切到前台立即拉。
 *
 * @module mark1/client/board
 */

const { createElement, useCallback, useEffect, useRef, useState } = require("react");
const { call } = __m("rpc");
const { CSS, c } = __m("styles");

/** 工单状态的展示语义。 */
const STATE_TONE = {
  active: { dot: 'ongoing', label: '进行中' },
  progress: { dot: 'ongoing', label: '推进中' },
  ready: { dot: 'done', label: '已交付' },
  blocked: { dot: 'warning', label: '受阻' },
  failed: { dot: 'error', label: '失败' },
  dropped: { dot: 'warning', label: '已放弃' }
}

/** 轮询间隔（毫秒）。开着这个 tab 才会跑。 */
const POLL_MS = 3000

/**
 * @param {object} props - slot 注入的东西（见 index.js 的 inject）。
 * @param {string} props.sessionId - 当前会话；用来判断看板是不是从这个会话里打开的。
 * @param {object} props.openSession - `(sessionId) => void`，跳到某个会话。
 * @param {object} props.primitives - 共用组件（StateDot / 图标 / MarkdownText）。
 * @param {Function} props.t - 文案函数（这里中文写死，t 只用来取少数宿主文案）。
 */
function Mark1Board({ sessionId, openSession, primitives }) {
  const {
    StateDot,
    IconRefreshOutlineRegular,
    IconChevronRightOutlineRegular,
    IconFolderOpenOutlineRegular,
    IconWarningTriangleOutlineRegular,
    IconPlayOutlineRegular,
    IconStopOutlineRegular,
    IconPaperPlaneOutlineRegular,
    IconListPenOutlineRegular
  } = primitives

  const [board, setBoard] = useState(undefined)
  const [error, setError] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [reveal, setReveal] = useState({})
  const [compose, setCompose] = useState(undefined)
  const [draft, setDraft] = useState('')
  const [showScenes, setShowScenes] = useState(false)
  const alive = useRef(true)

  /** 每张卡片只做一次两段式确认（点了「停止」之后 3 秒内再点才真停）。 */
  const [armed, setArmed] = useState({})
  const armTimer = useRef(undefined)
  useEffect(() => () => { if (armTimer.current !== undefined) clearTimeout(armTimer.current) }, [])

  const load = useCallback(async (options) => {
    try {
      const value = await call('board', { sessionId }, options?.signal)
      if (!alive.current) return
      setBoard(value)
      setError(undefined)
    } catch (failure) {
      if (failure?.name === 'AbortError') return
      if (!alive.current) return
      setError(String(failure?.message ?? failure))
    }
  }, [sessionId])

  const act = useCallback(async (endpoint, payload) => {
    setBusy(true)
    try {
      await call(endpoint, { sessionId, ...payload })
      await load()
      return true
    } catch (failure) {
      setError(String(failure?.message ?? failure))
      return false
    } finally {
      setBusy(false)
    }
  }, [sessionId, load])

  useEffect(() => {
    alive.current = true
    void load()
    const timer = setInterval(() => { void load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const tickets = Array.isArray(board?.tickets) ? board.tickets : []
  const activeCount = tickets.filter((t) => t.state === 'active').length
  const live = activeCount

  const toggle = useCallback((ticket) => {
    setExpanded((current) => ({ ...current, [ticket]: current[ticket] !== true }))
  }, [])

  const revealFile = useCallback(async (ticket, file) => {
    try {
      const value = await call('file', { ticket, file })
      setReveal((current) => ({ ...current, [`${ticket}:${file}`]: value?.text ?? '(空文件)' }))
    } catch (failure) {
      setReveal((current) => ({ ...current, [`${ticket}:${file}`]: `读取失败：${String(failure?.message ?? failure)}` }))
    }
  }, [])

  const header = createElement('div', { className: c('bar') },
    createElement('div', { className: c('bar-title') },
      createElement('span', { className: c('bar-name') }, '马克一号'),
      createElement('span', { className: c('bar-sub') }, live > 0 ? `${live} 个活工单 · ${tickets.length} 张票` : `${tickets.length} 张票`)
    ),
    createElement('button', {
      type: 'button',
      className: c('icon-btn'),
      title: '立即刷新',
      disabled: busy,
      onClick: () => { void load() }
    }, createElement(IconRefreshOutlineRegular, { size: 14 }))
  )

  const meta = createElement('div', { className: c('meta') },
    metaRow('路由会话', sessionValue(board?.router, openSession, sessionId)),
    board?.watchdog === undefined
      ? metaRow('看门狗', createElement('span', { className: c('mono') }, `已关（watchdogMinutes = 0）`))
      : metaRow('看门狗', sessionValue(board.watchdog, openSession, sessionId)),
    metaRow('活跃 / 上限', createElement('span', { className: c('mono') }, `${activeCount} / ${board?.maxTickets ?? '-'}`)),
    metaRow('场景包', createElement('span', { className: c('mono') }, String(board?.scenes?.length ?? 0))),
    metaRow('状态目录', createElement('span', { className: c('mono'), title: board?.stateDir }, board?.stateDir ?? '-'))
  )

  const errorBox = error === undefined ? null : createElement('div', { className: c('error') },
    createElement(IconWarningTriangleOutlineRegular, { size: 14 }),
    createElement('span', null, error)
  )

  const list = tickets.length === 0
    ? createElement('div', { className: c('empty') },
      createElement('span', { className: c('empty-title') }, '还没有工单'),
      createElement('span', null, '和「马克一号 · 路由」会话说一声要办的事，它会自己开子会话去干，干完回报到这里。')
    )
    : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      ...tickets.map((ticket) => ticketCard({
        ticket,
        expanded: expanded[ticket.ticket] === true,
        reveal,
        compose: compose === ticket.ticket ? draft : undefined,
        draft,
        busy,
        armed: armed[ticket.ticket] === true,
        openSession,
        sessionId,
        onToggle: () => toggle(ticket.ticket),
        onWake: () => {
          setCompose(ticket.ticket)
          setDraft('')
        },
        onDraft: setDraft,
        onCancelCompose: () => { setCompose(undefined); setDraft('') },
        onSend: async () => {
          const message = draft.trim()
          if (message.length === 0) return
          const done = await act('wake', { ticket: ticket.ticket, message })
          if (done) { setCompose(undefined); setDraft('') }
        },
        onStop: () => {
          if (armed[ticket.ticket] !== true) {
            if (armTimer.current !== undefined) clearTimeout(armTimer.current)
            setArmed({ [ticket.ticket]: true })
            armTimer.current = setTimeout(() => { setArmed({}) }, 3000)
            return
          }
          if (armTimer.current !== undefined) clearTimeout(armTimer.current)
          setArmed({})
          void act('stop', { ticket: ticket.ticket })
        },
        onReveal: (file) => { void revealFile(ticket.ticket, file) }
      }))
    )

  const scenesBox = showScenes
    ? createElement('div', null,
      ...(board?.scenes ?? []).map((scene) => createElement('div', { className: c('scene-row'), key: scene.id },
        createElement('div', { className: c('scene-main') },
          createElement('span', { className: c('scene-name') }, scene.name),
          createElement('span', { className: c('scene-desc') }, scene.id)
        )
      )),
      (board?.scenes ?? []).length === 0 ? createElement('p', { className: c('report-missing') }, '这个工作区没装场景包。注意：场景包按工作区生效，换工作区后可能看不到。') : null
    )
    : null

  return createElement('div', { className: c('root') },
    header,
    createElement('div', { className: c('body') },
      errorBox,
      meta,
      createElement('div', { className: c('section-label') },
        createElement('span', null, '工单'),
        createElement('span', null, tickets.length === 0 ? '' : `${live} 活跃`)
      ),
      list,
      createElement('div', { className: c('section-label') },
        createElement('button', {
          type: 'button',
          className: c('icon-btn'),
          'aria-pressed': showScenes,
          onClick: () => setShowScenes((value) => !value)
        }, createElement(IconListPenOutlineRegular, { size: 13 }), `场景包（${board?.scenes?.length ?? 0}）`)
      ),
      scenesBox
    )
  )

  // ── 子渲染 ──────────────────────────────────────────────────────────────

  function metaRow(key, value) {
    return createElement('div', { className: c('meta-row'), key },
      createElement('span', { className: c('meta-key') }, key),
      createElement('div', { className: c('meta-value') }, value)
    )
  }

  function sessionValue(id, open, current) {
    if (typeof id !== 'string' || id.length === 0) return createElement('span', { className: c('mono') }, '-')
    const self = id === current
    return createElement('button', {
      type: 'button',
      className: c('link'),
      title: self ? '当前会话' : `打开会话 ${id}`,
      onClick: () => { if (!self) open?.(id) }
    }, id, self ? ' · 当前' : '')
  }

  function ticketCard(input) {
    const { ticket, expanded: isOpen } = input
    const report = ticket.lastReport
    const tone = STATE_TONE[ticket.state] ?? STATE_TONE.active
    const reportTone = report === undefined ? undefined : (STATE_TONE[report.state] ?? undefined)
    const dot = reportTone?.dot ?? tone.dot

    const head = createElement('button', {
      type: 'button',
      className: c('card-head'),
      'aria-expanded': isOpen,
      onClick: input.onToggle
    },
      createElement(IconChevronRightOutlineRegular, { size: 14, className: c('chevron'), 'data-open': isOpen }),
      createElement(StateDot, { state: dot, className: c('row-dot') }),
      createElement('span', { className: c('card-main') },
        createElement('span', { className: c('card-title') },
          createElement('span', { className: c('card-title-text') }, ticket.title),
          noScene(ticket.scene)
        ),
        createElement('span', { className: c('card-sub') },
          createElement('span', null, ticket.ticket),
          createElement('span', null, '·'),
          createElement('span', null, report === undefined ? tone.label : `${reportTone?.label ?? report.state}`),
          createElement('span', null, '·'),
          createElement('span', { className: c('mono') }, ticket.sessionId)
        )
      )
    )

    if (!isOpen) {
      return createElement('div', { className: c('card'), 'data-state': ticket.state, key: ticket.ticket }, head)
    }

    const bodyChildren = []
    if (report === undefined) {
      bodyChildren.push(createElement('p', { className: c('report-missing'), key: 'none' }, '这个 Worker 还没调过 mark1_report。'))
    } else {
      bodyChildren.push(createElement('div', { className: c('report'), key: 'report' },
        createElement('div', { className: c('report-text') }, String(report.summary ?? '')),
        report.next ? createElement('div', { className: c('report-next') }, `下一步：${report.next}`) : null,
        report.at ? createElement('div', { className: c('report-next') }, `报告于 ${formatTime(report.at)}`) : null
      ))
    }

    if (Array.isArray(report?.files) && report.files.length > 0) {
      bodyChildren.push(createElement('ul', { className: c('files'), key: 'files' },
        ...report.files.map((file) => createElement('li', { className: c('file'), key: file },
          createElement(IconFolderOpenOutlineRegular, { size: 12 }),
          createElement('span', { className: c('mono'), title: file }, file)
        ))
      ))
    }

    bodyChildren.push(createElement('div', { className: c('tabs'), key: 'tabs' },
      ...['plan.md', 'sources.md', 'mark1-status.json'].map((file) => createElement('button', {
        type: 'button',
        className: c('tab'),
        key: file,
        'aria-pressed': reveal[`${ticket.ticket}:${file}`] !== undefined,
        onClick: () => input.onReveal(file)
      }, file))
    ))

    for (const [key, text] of Object.entries(reveal)) {
      if (!key.startsWith(`${ticket.ticket}:`)) continue
      bodyChildren.push(createElement('pre', { className: c('md'), key: `reveal:${key}` }, String(text)))
    }

    if (Array.isArray(board?.scenes) && board.scenes.length > 0) {
      const scene = board.scenes.find((entry) => entry.id === ticket.scene)
      if (scene !== undefined && typeof scene.description === 'string' && scene.description.length > 0) {
        bodyChildren.push(createElement('div', { className: c('report-next'), key: 'scene-desc' }, `场景「${scene.name}」：${scene.description}`))
      }
    }

    bodyChildren.push(createElement('div', { className: c('report-next'), key: 'dir' },
      `目录 ${ticket.directory}`,
      ticket.createdAt ? ` · 派发于 ${formatTime(ticket.createdAt)}` : ''
    ))

    if (input.compose !== undefined) {
      bodyChildren.push(createElement('textarea', {
        className: c('inline-input'),
        key: 'compose',
        value: input.draft,
        placeholder: '给这个 Worker 的追加指令（会唤醒它的会话）',
        onChange: (event) => input.onDraft(event.target.value)
      }))
      bodyChildren.push(createElement('div', { className: c('actions'), key: 'compose-actions' },
        createElement('button', { type: 'button', className: c('action'), disabled: input.busy, onClick: input.onSend },
          createElement(IconPaperPlaneOutlineRegular, { size: 12 }), '发送'),
        createElement('button', { type: 'button', className: c('action'), onClick: input.onCancelCompose }, '取消')
      ))
    }

    bodyChildren.push(createElement('div', { className: c('actions'), key: 'actions' },
      createElement('button', { type: 'button', className: c('action'), onClick: () => openSession?.(ticket.sessionId) },
        createElement(IconPlayOutlineRegular, { size: 12 }), '打开会话'),
      createElement('button', { type: 'button', className: c('action'), disabled: input.busy, onClick: input.onWake },
        createElement(IconPaperPlaneOutlineRegular, { size: 12 }), '追加指令'),
      ticket.state === 'active'
        ? createElement('button', {
          type: 'button',
          className: c('action'),
          'data-tone': 'danger',
          'data-armed': input.armed,
          disabled: input.busy,
          onClick: input.onStop
        }, createElement(IconStopOutlineRegular, { size: 12 }), input.armed ? '再点一次确认' : '停止')
        : null
    ))

    return createElement('div', { className: c('card'), 'data-state': ticket.state, key: ticket.ticket },
      head,
      createElement('div', { className: c('card-body') }, ...bodyChildren.filter((node) => node !== null && node !== undefined))
    )
  }

  function noScene(scene) {
    if (typeof scene !== 'string' || scene.length === 0) return null
    return createElement('span', { className: `${c('tag')} ${c('tag-scene')}` }, scene)
  }
}

/**
 * 把 ISO 时间压成人能读的短串。
 * @param {string} value - ISO timestamp.
 * @returns {string} `MM-DD HH:mm`.
 */
function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 注入本看板的样式（幂等；宿主的 style 标签只建一次）。
 * @returns {void}
 */
function installStyles() {
  const tagId = '@local/dsh-mark-one-v5/board.css'
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@local/dsh-mark-one-v5'
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}

exports.Mark1Board = Mark1Board;
exports.installStyles = installStyles;
},
"index": (module, exports, __m) => {
/**
 * 马克一号 · 浏览器端 UI 入口。
 *
 * 三块东西：
 *   1. 会话头按钮「马克一号」：在当前会话右侧打开/收起看板 tab。
 *   2. 右栏整页看板 tab（sidebar.right.pane.tab）：工单卡片 + 操作。
 *   3. tab 标题条（sidebar.right.pane.tab.title）：标题 + 活跃数。
 *
 * 只能 require 宿主白名单里的 10 个模块（react / react-dom / cordis / zod /
 * react-virtual / client-store / client-ui-slots / client-ui-primitives /
 * client-ui-dockkit / jsx-runtime），其它一律不可 import。
 *
 * @module mark1/client
 */

const { createElement } = require("react");
const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
const { installStyles } = __m("board");
const { Mark1Board } = __m("board");

/** 看板 tab 的 kind / id（打开时 `ctx.sidebarRight.openTab(KIND)` 用）。 */
const KIND = 'mark1-board'

/** 整个插件在 slot 体系里的命名空间。 */
const NS = 'mark1'

/** 注入的服务名。客户端插件只看得到这几个。 */
const inject = ['slots', 'locale']

/**
 * 客户端插件入口。
 * @param {object} ctx - Client root context.
 */
function apply(ctx) {
  installStyles()

  const openBoard = (sessionId) => {
    const sidebar = ctx.get('sidebarRight')
    if (sidebar === undefined) return
    try {
      if (sessionId === undefined) sidebar.openTab(KIND)
      else sidebar.openTabIn(sessionId, KIND)
      if (sidebar.isExpanded?.() !== true) sidebar.toggleExpanded?.()
    } catch {
      /* 没有挂载会话面板时宿主会抛；静默，因为按钮所在会话一定挂载了 */
    }
  }

  // 会话头按钮：进得了看板的第一入口。
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'mark1-board',
    order: 40,
    locale: NS,
    inject: (sessionId) => ({
      sessionId,
      primitives,
      openBoard: () => openBoard(sessionId)
    })
  }, HeaderButton)), 'mark1: header action')

  // 右栏整页看板。
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: KIND,
    locale: NS,
    children: {
      'sidebar.right.tab.mark1-board': { kind: 'keyed', scope: 'session' }
    },
    inject: (sessionId) => ({
      sessionId,
      primitives,
      openSession: (id) => {
        const workspace = ctx.get('uiWorkspace')
        try {
          workspace?.openSession?.(id)
        } catch {
          /* 打不开就算了，看板上仍然有会话 id */
        }
      }
    })
  }, Mark1Board)), 'mark1: board tab')

  // tab 标题条。
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: KIND,
    locale: NS,
    inject: () => ({ primitives })
  }, TabTitle)), 'mark1: board tab title')
}

/**
 * 会话头那颗按钮。
 * @param {object} props - `{ sessionId, openBoard, primitives }`.
 */
function HeaderButton({ openBoard, primitives }) {
  const { IconGoalOutlineRegular } = primitives
  return createElement('button', {
    type: 'button',
    className: 'mark1-header-trigger',
    title: '马克一号看板',
    'aria-label': '马克一号看板',
    onClick: () => openBoard()
  },
    createElement(IconGoalOutlineRegular, { size: 14 }),
    createElement('span', { className: 'mark1-header-label' }, '马克一号')
  )
}

/**
 * tab 标题条。
 * @param {object} props - `{ primitives }`.
 */
function TabTitle({ primitives }) {
  const { IconGoalOutlineRegular } = primitives
  return createElement('span', { className: 'mark1-tab-title' },
    createElement(IconGoalOutlineRegular, { size: 14 }),
    createElement('span', null, '马克一号')
  )
}

exports.KIND = KIND;
exports.inject = inject;
exports.apply = apply;
},
"rpc": (module, exports, __m) => {
/**
 * 马克一号 · 浏览器端 ↔ Host 的唯一条通道。
 *
 * 走 DSH 的精确 Fetch 路由（`ctx.connection.fetch.register`）：sessionController
 * 的官方 `/api/file` 就是这么做的，ds-bot 的 `/api/bot` 也是这么做的。
 * 请求体 `{ endpoint, payload }`，响应信封 `{ ok: true, value }` /
 * `{ ok: false, error: { code, message, details } }`。
 *
 * @module mark1/client/rpc
 */

/** 与 index.js 的 UI_ROUTE 必须一致。 */
const ROUTE = '/api/mark1'

/**
 * 调一次看板接口。
 * @param {string} endpoint - 端点名（host 侧 switch 分发）。
 * @param {object} [payload] - 端点参数。
 * @param {AbortSignal} [signal] - 取消信号。
 * @returns {Promise<any>} 成功返回 value，失败抛 Error（带 code）。
 */
async function call(endpoint, payload, signal) {
  let response
  try {
    response = await fetch(ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload: payload ?? null }),
      signal
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw withCode(new Error('连不上马克一号宿主进程'), 'mark1/network', error)
  }
  if (!response.ok) {
    throw withCode(new Error(`宿主返回 HTTP ${response.status}`), 'mark1/http', response.status)
  }
  let body
  try {
    body = await response.json()
  } catch {
    throw withCode(new Error('宿主返回的不是 JSON'), 'mark1/decode')
  }
  if (body?.ok === true) return body.value
  const error = body?.error ?? {}
  throw withCode(new Error(String(error.message ?? '未知错误')), String(error.code ?? 'mark1/error'), error.details)
}

/**
 * @param {Error} error - target.
 * @param {string} code - machine code.
 * @param {unknown} [details] - extra info.
 * @returns {Error} the same error with a code attached.
 */
function withCode(error, code, details) {
  error.code = code
  if (details !== void 0) error.details = details
  return error
}

exports.ROUTE = ROUTE;
exports.call = call;
},
"styles": (module, exports, __m) => {
/**
 * 马克一号 · 看板样式。
 *
 * 只用手写的类名（不用 CSS Modules，也不需要构建步骤）：所有规则挂在 `.mark1-*`
 * 前缀下，正好嵌进右栏 tab 里，不污染宿主其它区域。
 * 颜色/圆角尽量走 DSH 的设计 token，深浅色主题自动跟随。
 *
 * @module mark1/client/styles
 */

/** ⚠ 这段 CSS 会被原样塞进 <style>。 */
const CSS = `
.mark1-root {
  --mark1-gap: 8px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.mark1-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: .5px solid var(--dsw-alias-border-l1);
  flex: none;
}
.mark1-bar-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.mark1-bar-name {
  font-weight: 600;
  white-space: nowrap;
}
.mark1-bar-sub {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark1-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  cursor: pointer;
}
.mark1-icon-btn:hover:not(:disabled) {
  background: var(--dsw-alias-fill-l1);
  color: var(--dsw-alias-label-primary);
}
.mark1-icon-btn:disabled { opacity: .45; cursor: default; }
.mark1-icon-btn[aria-pressed="true"] { background: var(--dsw-alias-fill-l2); color: var(--dsw-alias-label-primary); }
.mark1-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mark1-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  letter-spacing: .02em;
}
.mark1-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-fill-l1);
}
.mark1-meta-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.mark1-meta-key {
  flex: none;
  width: 62px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}
.mark1-meta-value {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}
.mark1-mono {
  font-family: var(--dsw-font-mono);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark1-link {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark1-link:hover { text-decoration: underline; }
.mark1-card {
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-fill-l1);
  overflow: hidden;
}
.mark1-card[data-state="active"] { border-color: color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); }
.mark1-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  border: 0;
  background: transparent;
  width: 100%;
  text-align: left;
  color: inherit;
  font: inherit;
}
.mark1-card-head:hover { background: var(--dsw-alias-fill-l2); }
.mark1-card-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.mark1-card-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.mark1-card-title-text {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark1-card-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  min-width: 0;
}
.mark1-tag {
  flex: none;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-fill-l2);
  color: var(--dsw-alias-label-secondary);
  padding: 0 5px;
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
}
.mark1-tag-scene { background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); }
.mark1-chevron { flex: none; color: var(--dsw-alias-label-tertiary); transition: transform .12s; }
.mark1-chevron[data-open="true"] { transform: rotate(90deg); }
.mark1-card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 8px;
  border-top: .5px solid var(--dsw-alias-border-l1);
  padding-top: 8px;
}
.mark1-report {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mark1-report-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
}
.mark1-report-next { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.mark1-report-missing {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-style: italic;
}
.mark1-files {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.mark1-file {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.mark1-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mark1-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 8px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-specific-menu, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  cursor: pointer;
}
.mark1-action:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-fill-l2);
}
.mark1-action:disabled { opacity: .45; cursor: default; }
.mark1-action[data-tone="danger"]:hover:not(:disabled),
.mark1-action[data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);
}
.mark1-action[data-armed="true"] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
}
.mark1-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-fill-l1);
}
.mark1-tab {
  padding: 1px 8px;
  border: 0;
  border-radius: var(--dsw-radius-xs);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
  cursor: pointer;
}
.mark1-tab[aria-pressed="true"] {
  background: var(--dsw-specific-menu, var(--dsw-alias-fill-l2));
  color: var(--dsw-alias-label-primary);
}
.mark1-md {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  padding: 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-fill-l2);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-mono);
  font-size: 11px;
  line-height: 17px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mark1-inline-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 56px;
  padding: 6px 8px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-fill-l2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  resize: vertical;
}
.mark1-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px 12px;
  border: .5px dashed var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  color: var(--dsw-alias-label-tertiary);
}
.mark1-empty-title { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.mark1-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
  overflow-wrap: anywhere;
}
.mark1-scene-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 0;
  border-top: .5px solid var(--dsw-alias-border-l1);
}
.mark1-scene-row:first-of-type { border-top: 0; }
.mark1-scene-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.mark1-scene-name { color: var(--dsw-alias-label-primary); }
.mark1-scene-desc { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
`

/**
 * 给样式文件一个短类名。
 * @param {string} name - 语义名。
 * @returns {string} class 名。
 */
function c(name) {
  return `mark1-${name}`
}

exports.CSS = CSS;
exports.c = c;
}
		};
		var __cache = {};
		function __m(id) {
			var hit = __cache[id];
			if (hit !== void 0) return hit.exports;
			var built = { exports: {} };
			__cache[id] = built;
			__defs[id](built, built.exports, __m);
			return built.exports;
		}

		var entry = __m("index");
		exports.apply = entry.apply;
		exports.inject = entry.inject;
		return module.exports;
	}
});
