#!/usr/bin/env node
/**
 * 把 src/client/*.js 打成一个可以被 DSH 浏览器端加载的 client.js。
 *
 * 为什么不用 esbuild/rollup：宿主前端只白名单了 10 个模块（react、react-dom、
 * primitives、slots、store、dockkit…），打包器会把 `@deepseek-ai/dsh-client-ui-primitives`
 * 连同它依赖的 clsx / shiki / micromark 全部内联进来，那些都不在白名单里，
 * 一 require 就炸。所以这里只做一件事：**把源码原样搬进
 * `window.__ModuleLoader__.load({ id, factory })` 的外壳，模块之间改成一个极小的内联表。**
 *
 * 输入不需要构建（源码里没有 JSX / TypeScript），因此这个脚本没有依赖，也没有
 * 版本漂移。
 *
 * 用法：node scripts/build-client.mjs
 */

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const sourceDir = join(root, 'src', 'client')
const target = join(root, 'client.js')

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

/** 宿主前端白名单：只有这些可以从 factory 的 require 里拿到。 */
const HOST_MODULES = new Set([
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

const files = (await readdir(sourceDir)).filter((name) => name.endsWith('.js')).sort()

/** 每个源文件对应一个内部模块 id：'./board.js' → 'board'。 */
const modules = new Map()
for (const name of files) {
  modules.set(name.replace(/\.js$/, ''), await readFile(join(sourceDir, name), 'utf8'))
}

/**
 * 把一条 import 声明改写成对内部表 / 宿主 require 的调用。
 * 只支持本仓库源码实际用到的形态：default、namespace、named、side-effect。
 * @param {string} line - 单行 import 语句（已保证以 import 开头、以分号结尾）。
 * @param {string} from - 发起 import 的模块 id，用于解析相对路径。
 * @returns {string} 改写后的代码。
 */
function rewriteImport(line, from) {
  const match = /^import\s+(?:([\s\S]+?)\s+from\s+)?(['"])([^'"]+)\2\s*;?$/.exec(line.trim())
  if (match === null) throw new Error(`build-client: 不支持的 import 形态：${line.trim()}`)
  const [, clause, , specifier] = match

  if (specifier.startsWith('.')) {
    const id = resolveModuleId(from, specifier)
    const target = `${JSON.stringify(id)}`
    if (clause === undefined) return `__m(${target});`
    const namespace = /^\*\s+as\s+(\w+)$/.exec(clause)
    if (namespace !== null) return `const ${namespace[1]} = __m(${target});`
    const defaultOnly = /^(\w+)$/.exec(clause)
    if (defaultOnly !== null) return `const ${defaultOnly[1]} = __m(${target}).default;`
    const named = /^\{([\s\S]*)\}$/.exec(clause)
    if (named !== null) {
      const bindings = named[1]
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => {
          const [imported, local] = part.split(/\s+as\s+/)
          return imported === local || local === undefined ? imported : `${imported}: ${local}`
        })
      return `const { ${bindings.join(', ')} } = __m(${target});`
    }
    throw new Error(`build-client: 不支持的 import 子句：${clause}`)
  }

  if (!HOST_MODULES.has(specifier)) {
    throw new Error(`build-client: "${specifier}" 不在宿主白名单里，浏览器端拿不到它`)
  }
  const target = `require(${JSON.stringify(specifier)})`
  if (clause === undefined) return `${target};`
  const namespace = /^\*\s+as\s+(\w+)$/.exec(clause)
  if (namespace !== null) return `const ${namespace[1]} = ${target};`
  const defaultOnly = /^(\w+)$/.exec(clause)
  if (defaultOnly !== null) return `const ${defaultOnly[1]} = (${target}).default ?? ${target};`
  const named = /^\{([\s\S]*)\}$/.exec(clause)
  if (named !== null) {
    const bindings = named[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => {
        const [imported, local] = part.split(/\s+as\s+/)
        return imported === local || local === undefined ? imported : `${imported}: ${local}`
      })
    return `const { ${bindings.join(', ')} } = ${target};`
  }
  throw new Error(`build-client: 不支持的 import 子句：${clause}`)
}

/**
 * './rpc' → 'rpc'；'./board.js' → 'board'。
 * @param {string} from - 发起模块 id。
 * @param {string} specifier - 相对路径。
 * @returns {string} 模块 id。
 */
function resolveModuleId(from, specifier) {
  const id = resolve('/', from, specifier).slice(1).replace(/\.js$/, '')
  // resolve('/', 'board', './rpc.js') 得到 'board/rpc.js'；同目录引用要去掉上一层。
  const flat = id.split('/').pop()
  if (modules.has(flat)) return flat
  if (!modules.has(id)) throw new Error(`build-client: 找不到模块 "${specifier}"（来自 ${from}）`)
  return id
}

const bodies = []
for (const [id, source] of modules) {
  const exported = []
  const lines = []
  for (const line of source.split('\n')) {
    if (/^\s*import\b/.test(line)) { lines.push(rewriteImport(line, id)); continue }
    if (/^\s*export\s+\{[^}]*\}\s*;?\s*$/.test(line)) {
      const names = line.trim().replace(/^export\s*\{/, '').replace(/\}\s*;?$/, '')
      for (const part of names.split(',').map((s) => s.trim()).filter((s) => s.length > 0)) {
        const [local, alias] = part.split(/\s+as\s+/)
        exported.push([alias ?? local, local])
      }
      continue
    }
    const declaration = /^\s*export\s+((?:async\s+)?(?:function|const|let|class)\s+(\w+))/.exec(line)
    if (declaration !== null) {
      exported.push([declaration[2], declaration[2]])
      lines.push(line.replace(/^(\s*)export\s+/, '$1'))
      continue
    }
    if (/^\s*export\s/.test(line)) throw new Error(`build-client: ${id} 里有不支持的 export 形态：${line.trim()}`)
    lines.push(line)
  }
  const tail = exported.map(([name, local]) => `exports.${name} = ${local};`).join('\n')
  bodies.push(`${JSON.stringify(id)}: (module, exports, __m) => {\n${lines.join('\n')}\n${tail}\n}`)
}

const output = `/* 由 scripts/build-client.mjs 生成，不要手改；改 src/client/ 后重新运行 npm run build。 */
window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

\t\t/** 内部模块表：按需执行一次，结果缓存。 */
\t\tvar __defs = {
${bodies.join(',\n')}
\t\t};
\t\tvar __cache = {};
\t\tfunction __m(id) {
\t\t\tvar hit = __cache[id];
\t\t\tif (hit !== void 0) return hit.exports;
\t\t\tvar built = { exports: {} };
\t\t\t__cache[id] = built;
\t\t\t__defs[id](built, built.exports, __m);
\t\t\treturn built.exports;
\t\t}

\t\tvar entry = __m("index");
\t\texports.apply = entry.apply;
\t\texports.inject = entry.inject;
\t\treturn module.exports;
\t}
});
`

await writeFile(target, output, 'utf8')
const rel = relative(process.cwd(), target) || target
process.stdout.write(`build-client: 写出 ${rel}（${modules.size} 个源模块，${output.length} 字节）\n`)
