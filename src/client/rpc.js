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
export const ROUTE = '/api/mark1'

/**
 * 调一次看板接口。
 * @param {string} endpoint - 端点名（host 侧 switch 分发）。
 * @param {object} [payload] - 端点参数。
 * @param {AbortSignal} [signal] - 取消信号。
 * @returns {Promise<any>} 成功返回 value，失败抛 Error（带 code）。
 */
export async function call(endpoint, payload, signal) {
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
