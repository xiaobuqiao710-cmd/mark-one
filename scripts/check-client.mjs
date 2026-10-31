/**
 * 看板契约自检：不解页面、不开浏览器，只把「host 返回什么」和「client 读什么」对齐。
 *
 * 这类错误在运行时是**静默的**（读 `board.router` 而 host 给的是 `routerSessionId`，
 * 页面上只是显示一个 `-`），所以用一次 grep 就能挡住。
 *
 * 用法：`node scripts/check-client.mjs`
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relative) => readFile(resolve(root, relative), 'utf8')

const [host, board, rpc, entry] = await Promise.all([
  read('index.js'),
  read('src/client/board.js'),
  read('src/client/rpc.js'),
  read('src/client/index.js')
])

const problems = []
const expect = (condition, message) => {
  if (!condition) problems.push(message)
}

// 1. host 的 board 快照键名 == client 读取的键名。
const snapshot = /function boardSnapshot\([^)]*\)\s*\{[\s\S]*?\n(\s*)return \{([\s\S]*?)\n\1\}/.exec(host)
expect(snapshot !== null, 'index.js: 找不到 boardSnapshot 的 return 块（结构被改动了，改这个脚本）')
const indent = (snapshot?.[1] ?? '').length + 2
const hostKeys = new Set(
  (snapshot?.[2] ?? '')
    .split('\n')
    .map((line) => /(\w+)\s*(?::|,)/.exec(line)?.[1])
    .filter((key) => key !== undefined)
    .filter((key) => key !== 'return')
)
for (const stale of ['routerSessionId', 'watchdogSessionId']) {
  expect(!new RegExp(`board\\??\\.${stale}\\b`).test(board), `board.js 读了 board.${stale}，但 host 快照里叫 ${stale.replace('SessionId', '')}`)
}
expect(hostKeys.has('router'), 'index.js: boardSnapshot 没有返回 router')

// 2. host 认的端点 == client 发出的端点。
const hostEndpoints = new Set([...host.matchAll(/case '([a-z-]+)':/g)].map((match) => match[1]))
const clientEndpoints = new Set([...board.matchAll(/call\('([a-z-]+)'/g)].map((match) => match[1]))
for (const endpoint of clientEndpoints) {
  expect(hostEndpoints.has(endpoint), `board.js 调了 '${endpoint}'，但 serveUi 里没有这个 case`)
}

// 3. 两端路由常量一致。
const routeOf = (source, pattern) => pattern.exec(source)?.[1]
const hostRoute = routeOf(host, /const UI_ROUTE = '([^']+)'/)
const clientRoute = routeOf(rpc, /const ROUTE = '([^']+)'/)
expect(hostRoute !== undefined && hostRoute === clientRoute, `路由不一致：host ${hostRoute} vs client ${clientRoute}`)

// 4. client 的 import 只用宿主白名单。
const allowed = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit'
])
for (const source of [board, entry, rpc, await read('src/client/styles.js')]) {
  for (const match of source.matchAll(/^import[\s\S]*?from\s+'([^']+)'/gm)) {
    const specifier = match[1]
    if (specifier.startsWith('.')) continue
    expect(allowed.has(specifier), `client 引用了白名单外的模块：${specifier}`)
  }
}

// 5. 注册的 slot 与 pane tab 的 kind 要一致（kind 与 key 必须同名，否则 tab 打不开）。
const kind = routeOf(entry, /const KIND = '([^']+)'/)
expect(entry.includes("key: KIND"), 'src/client/index.js: sidebar.right.pane.tab 的 key 应该是 KIND')
expect(entry.includes(`name: 'sidebar.right.pane.tab'`), 'src/client/index.js: 没有注册 sidebar.right.pane.tab')

// 6. package.json 的浏览器声明与产物，要和 client-modules 的加载条件对上。
//    （`dsh.client` 在而 `exports["./client"]` 不在 → 直接抛错；产物不存在 → 运行时 404）
const pkg = JSON.parse(await read('package.json'))
expect(pkg.dsh?.client?.platform === 'web', `package.json: dsh.client.platform 应为 "web"，实际 ${pkg.dsh?.client?.platform}`)
const clientExport = pkg.exports?.['./client']
expect(typeof clientExport === 'string', 'package.json: exports["./client"] 必须是字符串')
if (typeof clientExport === 'string') {
  const artifact = await read(clientExport.replace(/^\.\//, '')).catch(() => undefined)
  expect(artifact !== undefined, `package.json: exports["./client"] 指向的 ${clientExport} 不存在（先 npm run build）`)
  if (artifact !== undefined) {
    expect(artifact.includes('__ModuleLoader__.load'), `${clientExport} 不是 __ModuleLoader__.load 产物`)
    expect(artifact.includes(`id: "${pkg.name}"`), `${clientExport} 里的 id 与包名 ${pkg.name} 不一致`)
    for (const match of artifact.matchAll(/require\("([^"]+)"\)/g)) {
      expect(allowed.has(match[1]), `${clientExport} 里 require 了白名单外的模块：${match[1]}`)
    }
  }
}

if (problems.length > 0) {
  console.error('check-client: 发现 %d 个问题', problems.length)
  for (const problem of problems) console.error(' -', problem)
  process.exitCode = 1
} else {
  console.log('check-client: 通过（host 快照键 %d 个 / 端点 %s / 路由 %s / tab kind %s）',
    hostKeys.size, [...clientEndpoints].join(','), clientRoute, kind)
}
