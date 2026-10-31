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

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { call } from './rpc.js'
import { CSS, c } from './styles.js'

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
export function Mark1Board({ sessionId, openSession, primitives }) {
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
export function installStyles() {
  const tagId = '@local/dsh-mark-one-v5/board.css'
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@local/dsh-mark-one-v5'
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}
