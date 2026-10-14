import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Dependency rules for `src`, in the spirit of the backend's ArchitectureTests:
 * `api` uses neither `features` nor `components`, `components` does not use `features`,
 * and no module takes part in a runtime import cycle. Type-only imports never run, so they
 * count for the layer rules but not for cycles. Dynamic `import()` loads later, so it counts
 * for the layer rules only.
 */
interface ModuleImport { specifier: string; typeOnly: boolean; dynamic: boolean }

function moduleImports(fileName: string, text: string): ModuleImport[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: ModuleImport[] = []
  const typeOnlyNames = (elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[]) =>
    elements.length > 0 && elements.every(element => element.isTypeOnly)
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const typeOnly = !!clause && (clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
        !clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && typeOnlyNames(clause.namedBindings.elements))
      found.push({ specifier: node.moduleSpecifier.text, typeOnly, dynamic: false })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = node.isTypeOnly || !!node.exportClause && ts.isNamedExports(node.exportClause) && typeOnlyNames(node.exportClause.elements)
      found.push({ specifier: node.moduleSpecifier.text, typeOnly, dynamic: false })
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments
      if (argument && ts.isStringLiteralLike(argument)) found.push({ specifier: argument.text, typeOnly: false, dynamic: true })
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push({ specifier: node.argument.literal.text, typeOnly: true, dynamic: false })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isSource = (name: string) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return path === join(src, 'test') ? [] : sourceFiles(path)
    return isSource(entry.name) ? [path] : []
  })
}

interface Edge { from: string; to: string; typeOnly: boolean; dynamic: boolean }

function dependencyGraph() {
  const files = sourceFiles(src)
  const known = new Set(files)
  const target = (from: string, specifier: string) => {
    const base = specifier.startsWith('@/') ? join(src, specifier.slice(2))
      : specifier.startsWith('.') ? resolve(dirname(from), specifier) : null
    if (!base) return null
    return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(path => known.has(path)) ?? null
  }
  const name = (path: string) => relative(src, path).split('\\').join('/')
  const edges: Edge[] = files.flatMap(file => moduleImports(file, readFileSync(file, 'utf8')).flatMap(({ specifier, typeOnly, dynamic }) => {
    const to = target(file, specifier)
    return to ? [{ from: name(file), to: name(to), typeOnly, dynamic }] : []
  }))
  return { modules: files.map(name), edges }
}

/** One readable cycle per strongly connected group of modules, e.g. `a.ts → b.ts → a.ts`. */
function runtimeCycles(modules: readonly string[], edges: readonly Edge[]): string[] {
  const next = new Map(modules.map(module => [module, [] as string[]]))
  for (const edge of edges) if (!edge.typeOnly && !edge.dynamic) next.get(edge.from)?.push(edge.to)
  // Tarjan's strongly connected components.
  let counter = 0
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>()
  const groups: string[][] = []
  const connect = (module: string) => {
    index.set(module, counter); low.set(module, counter++); stack.push(module); onStack.add(module)
    for (const to of next.get(module) ?? []) {
      if (!index.has(to)) { connect(to); low.set(module, Math.min(low.get(module)!, low.get(to)!)) }
      else if (onStack.has(to)) low.set(module, Math.min(low.get(module)!, index.get(to)!))
    }
    if (low.get(module) !== index.get(module)) return
    const group: string[] = []
    let member: string
    do { member = stack.pop()!; onStack.delete(member); group.push(member) } while (member !== module)
    if (group.length > 1 || next.get(module)!.includes(module)) groups.push(group)
  }
  for (const module of modules) if (!index.has(module)) connect(module)
  return groups.map(group => {
    // The shortest way back to the first member, through members of the same group only.
    const members = new Set(group), start = [...group].sort()[0]!
    const previous = new Map<string, string>()
    const queue = [start]
    while (queue.length) {
      const module = queue.shift()!
      for (const to of next.get(module) ?? []) {
        if (!members.has(to)) continue
        if (to === start) {
          const path: string[] = []
          for (let at = module; at !== start; at = previous.get(at)!) path.unshift(at)
          return [start, ...path, start].join(' → ')
        }
        if (!previous.has(to)) { previous.set(to, module); queue.push(to) }
      }
    }
    return group.join(' → ')
  }).sort()
}

const layer = (module: string) => module.split('/')[0]!

describe('import analysis', () => {
  it('tells runtime, type-only and dynamic imports apart', () => {
    const imports = moduleImports('example.tsx', [
      "import type { A } from './a'",
      "import { type B, type C } from './b'",
      "import { type D, e } from './c'",
      "import f, { type G } from './d'",
      "import './styles.css'",
      "export type { H } from './e'",
      "export { i } from './f'",
      "export * from './g'",
      "const lazy = () => import('./h')",
      "let x: import('./i').X",
    ].join('\n'))
    expect(imports).toEqual([
      { specifier: './a', typeOnly: true, dynamic: false },
      { specifier: './b', typeOnly: true, dynamic: false },
      { specifier: './c', typeOnly: false, dynamic: false },
      { specifier: './d', typeOnly: false, dynamic: false },
      { specifier: './styles.css', typeOnly: false, dynamic: false },
      { specifier: './e', typeOnly: true, dynamic: false },
      { specifier: './f', typeOnly: false, dynamic: false },
      { specifier: './g', typeOnly: false, dynamic: false },
      { specifier: './h', typeOnly: false, dynamic: true },
      { specifier: './i', typeOnly: true, dynamic: false },
    ])
  })
  it('reports runtime cycles and ignores type-only and dynamic edges', () => {
    const edge = (from: string, to: string, typeOnly = false, dynamic = false) => ({ from, to, typeOnly, dynamic })
    expect(runtimeCycles(['a', 'b', 'c', 'd'], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('d', 'd')])).toEqual(['a → b → c → a', 'd → d'])
    expect(runtimeCycles(['a', 'b'], [edge('a', 'b'), edge('b', 'a', true)])).toEqual([])
    expect(runtimeCycles(['a', 'b'], [edge('a', 'b'), edge('b', 'a', false, true)])).toEqual([])
  })
})

describe('frontend architecture', () => {
  const { modules, edges } = dependencyGraph()
  const crossing = (from: string, forbidden: readonly string[]) => edges
    .filter(edge => layer(edge.from) === from && forbidden.includes(layer(edge.to)))
    .map(edge => `${edge.from} → ${edge.to}`)

  it('reads the application sources', () => {
    expect(modules).toContain('api/workspace.ts')
    expect(modules).toContain('features/workspace/ApplicationShell.tsx')
    expect(modules.some(module => module.endsWith('.test.ts') || module.startsWith('test/'))).toBe(false)
  })
  it('keeps the API layer free of features and components', () => {
    expect(crossing('api', ['features', 'components'])).toEqual([])
  })
  it('keeps components free of features', () => {
    expect(crossing('components', ['features'])).toEqual([])
  })
  it('has no runtime import cycles', () => {
    expect(runtimeCycles(modules, edges)).toEqual([])
  })
})
