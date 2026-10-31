/**
 * 马克一号 · 场景包注入
 *
 * 场景包 = 一段领域流程 + 一个交付骨架。它的正文放在 bundle 的
 * `skills/<id>/SKILL.md` 里（人可以编辑），运行时按「装了哪些场景」把它注册成
 * DSH 技能，模型就会在 `skill` 工具目录里看到它、需要时加载。
 *
 * 为什么不用 bundle 自己的 `ctx.skills`：技能注册按**注册者 ctx 的层**隔离
 * （`dsh-skill/lib/index.js` 的 `register()` → `scopeOf(this.ctx)` → `layers.effect`），
 * 而加载技能的是 Worker 会话自己的 agent 作用域。场景包必须注册到**每个 agent
 * 自己的 ctx** 上，所以在 `agent/created` 里挂、在 `agent/disposed` 里收。
 *
 * @module @local/dsh-mark-one/scenes
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 技能名合法形态（DSH 保留 `^[a-z0-9]+(?:-[a-z0-9]+)*$`）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 读一个场景包的 skill 正文。
 * @param dir - bundle 里的 `skills/` 目录。
 * @param id - 场景包 id（同时是目录名）。
 * @returns 正文；读不到时返回 undefined，由调用方回退到 config 里内联的 skillContent。
 */
export function readSceneSkill(dir, id) {
  if (!SKILL_NAME.test(id)) return void 0
  try {
    const text = readFileSync(join(dir, id, 'SKILL.md'), 'utf8')
    return text.trim().length > 0 ? text : void 0
  } catch {
    return void 0
  }
}

/**
 * 从一个场景包 config 行解析出可注册的技能定义。
 * @param scene - config.scenes 的一项。
 * @param dir - bundle 里的 `skills/` 目录。
 * @returns 技能定义；该场景不提供技能时返回 undefined。
 */
export function sceneSkill(scene, dir) {
  const id = typeof scene?.skill === 'string' ? scene.skill : scene?.id
  if (typeof id !== 'string' || !SKILL_NAME.test(id)) return void 0
  const content = readSceneSkill(dir, id) ?? (typeof scene.skillContent === 'string' ? scene.skillContent : '')
  if (content.trim().length === 0) return void 0
  return {
    name: id,
    description: scene.description ?? `${scene.name ?? id}：领域流程与交付骨架。`,
    content,
    provider: 'runtime',
    resourceBase: { kind: 'directory', path: join(dir, id) }
  }
}

/**
 * 把场景包挂到每个新 agent 的技能层上，并在 agent 销毁时收回。
 *
 * 依赖 `agent/created` / `agent/disposed` 与 `TryGet Service`：宿主没装技能服务时
 * 静默跳过，不影响插件其余部分。
 * @param ctx - 插件自己的 ctx（用来收 effect 与监听事件）。
 * @param scenes - config.scenes。
 * @param dir - bundle 里的 `skills/` 目录。
 */
export function mountScenes(ctx, scenes, dir) {
  const defs = []
  for (const scene of Array.isArray(scenes) ? scenes : []) {
    const def = sceneSkill(scene, dir)
    if (def !== void 0) defs.push(def)
  }
  if (defs.length === 0) return

  /** @type {WeakMap<object, Array<() => void>>} */
  const owned = new WeakMap()

  ctx.on('agent/created', ({ agent }) => {
    if (owned.has(agent)) return
    const skills = tryService(agent.ctx, 'skills')
    if (skills === void 0 || typeof skills.register !== 'function') return
    const disposers = []
    for (const def of defs) {
      try {
        disposers.push(skills.register({ ...def, resourceBase: { ...def.resourceBase } }))
      } catch {
        /* 同名技能先到先得；重复注册不该拖垮 agent 创建 */
      }
    }
    owned.set(agent, disposers)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    for (const dispose of owned.get(agent) ?? []) {
      try {
        dispose()
      } catch {
        /* 层已经随 agent 一起没了 */
      }
    }
    owned.delete(agent)
  })
}

/**
 * 取一个可能不存在的服务。
 * @param ctx - 任意 ctx。
 * @param name - 服务名。
 * @returns 服务实例或 undefined。
 */
function tryService(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return void 0
  }
}
