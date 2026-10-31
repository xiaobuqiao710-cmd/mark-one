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

import { createElement, useState } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { installStyles } from './board.js'
import { Mark1Board } from './board.js'

/** 看板 tab 的 kind / id（打开时 `ctx.sidebarRight.openTab(KIND)` 用）。 */
export const KIND = 'mark1-board'

/** 整个插件在 slot 体系里的命名空间。 */
const NS = 'mark1'

/** 注入的服务名。客户端插件只看得到这几个。 */
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']

/**
 * 客户端插件入口。
 * @param {object} ctx - Client root context.
 */
export function apply(ctx) {
  installStyles()

  // 右栏的 tab 类型注册表。不做这一步，openTab(KIND) 会抛
  // `sidebarRight: no tab type is registered as "mark1-board"`。
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: KIND,
    kind: KIND,
    title: () => '马克一号'
  }), 'mark1: sidebar tab type')

  /**
   * 打开看板。返回空串表示成功，否则返回失败原因（按钮拿它显示，不再静默）。
   * @param {string | undefined} sessionId - 当前会话。
   */
  const openBoard = (sessionId) => {
    const sidebar = ctx.sidebarRight
    try {
      if (sessionId === undefined) sidebar.openTab(KIND)
      else sidebar.openTabIn(sessionId, KIND)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    if (sidebar.isExpanded() !== true) sidebar.toggleExpanded()
    return ''
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
  const [failure, setFailure] = useState('')
  return createElement('button', {
    type: 'button',
    className: 'mark1-header-trigger',
    'data-failed': failure === '' ? undefined : 'true',
    title: failure === '' ? '马克一号看板' : `马克一号看板打不开：${failure}`,
    'aria-label': '马克一号看板',
    onClick: () => setFailure(openBoard())
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
