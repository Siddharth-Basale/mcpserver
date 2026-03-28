import { useCallback, useMemo, useState } from 'react'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

type ConnState = 'disconnected' | 'connecting' | 'connected' | 'error'

type TimelineEntry = {
  id: string
  tool: string
  args: Record<string, unknown>
  startedAt: number
  endedAt?: number
  status: 'running' | 'ok' | 'error'
  result?: unknown
  error?: string
}

function parseToolResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result
  const r = result as Record<string, unknown>
  if ('structuredContent' in r && r.structuredContent !== undefined) {
    return r.structuredContent
  }
  const content = r.content
  if (Array.isArray(content)) {
    const text = content.find((c) => c && typeof c === 'object' && (c as { type?: string }).type === 'text') as
      | { text?: string }
      | undefined
    const t = text?.text
    if (t) {
      try {
        return JSON.parse(t) as unknown
      } catch {
        return t
      }
    }
  }
  return result
}

function findPrUrl(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const o = data as Record<string, unknown>
  const pr = o.pull_request
  if (pr && typeof pr === 'object') {
    const u = (pr as Record<string, unknown>).html_url
    if (typeof u === 'string') return u
  }
  return undefined
}

function deepFindHtmlUrl(obj: unknown, depth = 0): string | undefined {
  if (depth > 8 || obj === null || obj === undefined) return undefined
  if (typeof obj === 'string' && obj.startsWith('https://') && obj.includes('pull')) {
    return obj
  }
  if (typeof obj !== 'object') return undefined
  for (const v of Object.values(obj)) {
    const found = deepFindHtmlUrl(v, depth + 1)
    if (found) return found
  }
  return undefined
}

const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/

export default function App() {
  const [conn, setConn] = useState<ConnState>('disconnected')
  const [mcpUrlInput, setMcpUrlInput] = useState('')
  const [client, setClient] = useState<Client | null>(null)
  const [transport, setTransport] = useState<StreamableHTTPClientTransport | null>(null)
  const [tools, setTools] = useState<Tool[]>([])
  const [connError, setConnError] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const [repository, setRepository] = useState('')
  const [runId, setRunId] = useState('')
  const [workflowName, setWorkflowName] = useState('')
  const [baseBranch, setBaseBranch] = useState('main')

  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [running, setRunning] = useState(false)

  const resolvedMcpUrl = useMemo(() => {
    const t = mcpUrlInput.trim()
    if (t) {
      try {
        return new URL(t)
      } catch {
        return null
      }
    }
    return new URL('/mcp', typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173')
  }, [mcpUrlInput])

  const connect = useCallback(async () => {
    setConnError(null)
    setRunError(null)
    setConn('connecting')
    setTools([])
    try {
      const url = resolvedMcpUrl
      if (!url) {
        throw new Error('Invalid MCP URL. Use a full URL like http://127.0.0.1:8000/mcp')
      }
      const t = new StreamableHTTPClientTransport(url)
      const c = new Client({ name: 'agentic-cicd-ui', version: '1.0.0' })
      await c.connect(t)
      const listed = await c.listTools()
      setClient(c)
      setTransport(t)
      setTools(listed.tools ?? [])
      setConn('connected')
    } catch (e) {
      setConn('error')
      const msg = e instanceof Error ? e.message : String(e)
      setConnError(
        msg +
          (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')
            ? ' — Is the MCP server running? For cross-origin requests, set MCP_CORS_ORIGINS on the server.'
            : ''),
      )
      setClient(null)
      setTransport(null)
    }
  }, [resolvedMcpUrl])

  const disconnect = useCallback(async () => {
    try {
      await transport?.close()
    } catch {
      /* ignore */
    }
    setClient(null)
    setTransport(null)
    setTools([])
    setConn('disconnected')
    setConnError(null)
  }, [transport])

  const appendTimeline = useCallback((entry: TimelineEntry) => {
    setTimeline((prev) => [...prev, entry])
  }, [])

  const updateTimeline = useCallback((id: string, patch: Partial<TimelineEntry>) => {
    setTimeline((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }, [])

  const runAutofix = useCallback(async () => {
    if (!client) return
    const repo = repository.trim()
    if (!REPO_PATTERN.test(repo)) {
      setRunError('Repository must look like owner/name (e.g. octocat/Hello-World).')
      return
    }
    setRunError(null)
    setRunning(true)

    let runIdNum: number | null = null
    const rid = runId.trim()
    if (rid) {
      const n = parseInt(rid, 10)
      if (Number.isNaN(n)) {
        setRunError('Run ID must be a number.')
        setRunning(false)
        return
      }
      runIdNum = n
    }

    try {
      if (runIdNum === null) {
        const id = crypto.randomUUID()
        const args: Record<string, unknown> = { repository: repo }
        if (workflowName.trim()) args.workflow_name = workflowName.trim()
        appendTimeline({
          id,
          tool: 'resolve_latest_failed_run',
          args,
          startedAt: Date.now(),
          status: 'running',
        })
        const raw = await client.callTool({ name: 'resolve_latest_failed_run', arguments: args })
        const parsed = parseToolResult(raw) as Record<string, unknown>
        const ended = Date.now()
        updateTimeline(id, {
          status: 'ok',
          endedAt: ended,
          result: parsed,
        })
        if (!parsed.found || typeof parsed.run_id !== 'number') {
          setRunError(typeof parsed.message === 'string' ? parsed.message : 'No failed run found.')
          setRunning(false)
          return
        }
        runIdNum = parsed.run_id
      }

      const id2 = crypto.randomUUID()
      const args2: Record<string, unknown> = {
        repository: repo,
        run_id: runIdNum,
        base_branch: baseBranch.trim() || 'main',
      }
      appendTimeline({
        id: id2,
        tool: 'orchestrate_autofix',
        args: args2,
        startedAt: Date.now(),
        status: 'running',
      })
      const raw2 = await client.callTool({ name: 'orchestrate_autofix', arguments: args2 })
      const parsed2 = parseToolResult(raw2)
      updateTimeline(id2, {
        status: 'ok',
        endedAt: Date.now(),
        result: parsed2,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setRunError(msg)
      setTimeline((prev) => {
        const last = [...prev].reverse().find((x) => x.status === 'running')
        if (!last) return prev
        return prev.map((x) =>
          x.id === last.id ? { ...x, status: 'error' as const, error: msg, endedAt: Date.now() } : x,
        )
      })
    } finally {
      setRunning(false)
    }
  }, [
    client,
    repository,
    runId,
    workflowName,
    baseBranch,
    appendTimeline,
    updateTimeline,
  ])

  const lastResult = [...timeline].reverse().find((t) => t.tool === 'orchestrate_autofix' && t.status === 'ok')
    ?.result
  const prUrl =
    findPrUrl(lastResult) ?? (lastResult ? deepFindHtmlUrl(lastResult) : undefined)

  const statusBadge =
    conn === 'connected'
      ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'
      : conn === 'connecting'
        ? 'bg-amber-500/15 text-amber-200 ring-amber-500/40'
        : conn === 'error'
          ? 'bg-red-500/15 text-red-300 ring-red-500/40'
          : 'bg-zinc-700/50 text-zinc-400 ring-zinc-600'

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="border-b border-zinc-800/80 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Agentic CI/CD</h1>
            <p className="text-sm text-zinc-500">MCP client — inspect failures and run autofix</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ${statusBadge}`}
            >
              {conn === 'connected' ? 'Connected' : conn === 'connecting' ? 'Connecting…' : conn === 'error' ? 'Error' : 'Disconnected'}
            </span>
            {resolvedMcpUrl && (
              <code className="text-xs text-zinc-500 max-w-[220px] truncate hidden sm:inline" title={resolvedMcpUrl.href}>
                {resolvedMcpUrl.href}
              </code>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <section className="lg:col-span-4 space-y-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl shadow-black/20">
            <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-3">Connection</h2>
            <label className="block text-xs text-zinc-500 mb-1">MCP endpoint URL (empty = dev proxy → /mcp)</label>
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              placeholder="http://127.0.0.1:8000/mcp"
              value={mcpUrlInput}
              onChange={(e) => setMcpUrlInput(e.target.value)}
              disabled={conn === 'connected' || conn === 'connecting'}
            />
            <div className="mt-4 flex gap-2">
              {conn !== 'connected' ? (
                <button
                  type="button"
                  onClick={() => void connect()}
                  disabled={conn === 'connecting'}
                  className="flex-1 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
                >
                  Connect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  className="flex-1 rounded-lg border border-zinc-600 bg-zinc-800/80 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
            {connError && (
              <p className="mt-3 text-sm text-red-400 whitespace-pre-wrap">{connError}</p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl shadow-black/20">
            <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-3">Tools</h2>
            {tools.length === 0 ? (
              <p className="text-sm text-zinc-500">Connect to list tools from the server.</p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {tools.map((t) => (
                  <li
                    key={t.name}
                    className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2 text-left"
                  >
                    <div className="font-mono text-xs text-violet-300">{t.name}</div>
                    {t.description && (
                      <div className="text-xs text-zinc-500 mt-1 line-clamp-2">{t.description}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="lg:col-span-8 space-y-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl shadow-black/20">
            <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wide mb-4">Run autofix</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">Repository (owner/name)</label>
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono text-zinc-200"
                  placeholder="octocat/Hello-World"
                  value={repository}
                  onChange={(e) => setRepository(e.target.value)}
                  disabled={conn !== 'connected' || running}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Run ID (optional)</label>
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono text-zinc-200"
                  placeholder="Auto: latest failed"
                  value={runId}
                  onChange={(e) => setRunId(e.target.value)}
                  disabled={conn !== 'connected' || running}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Workflow name (optional)</label>
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                  placeholder="Filter when resolving run"
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  disabled={conn !== 'connected' || running}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">Base branch</label>
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono text-zinc-200"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  disabled={conn !== 'connected' || running}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void runAutofix()}
              disabled={conn !== 'connected' || running || !repository.trim()}
              className="mt-6 w-full sm:w-auto rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {running ? 'Running…' : 'Resolve run & orchestrate autofix'}
            </button>
            {runError && (
              <p className="mt-3 text-sm text-red-400 whitespace-pre-wrap">{runError}</p>
            )}
            <p className="mt-2 text-xs text-zinc-500">
              If Run ID is empty, the client calls <code className="text-zinc-400">resolve_latest_failed_run</code> then{' '}
              <code className="text-zinc-400">orchestrate_autofix</code> — both appear in the timeline.
            </p>
          </div>

          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-5 py-4 text-center text-emerald-300 hover:bg-emerald-900/40 transition-colors"
            >
              <span className="font-medium">Open pull request</span>
              <span aria-hidden>↗</span>
            </a>
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wide">Tool call timeline</h2>
              {timeline.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                  onClick={() => setTimeline([])}
                >
                  Clear
                </button>
              )}
            </div>
            {timeline.length === 0 ? (
              <p className="text-sm text-zinc-500">No tool calls yet.</p>
            ) : (
              <ul className="space-y-3">
                {timeline.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-lg border border-zinc-800/90 bg-zinc-950/60 overflow-hidden"
                  >
                    <details open className="group">
                      <summary className="cursor-pointer list-none px-4 py-3 flex flex-wrap items-center gap-2 text-left">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            entry.status === 'running'
                              ? 'bg-amber-400 animate-pulse'
                              : entry.status === 'ok'
                                ? 'bg-emerald-500'
                                : 'bg-red-500'
                          }`}
                        />
                        <span className="font-mono text-sm text-violet-300">{entry.tool}</span>
                        <span className="text-xs text-zinc-500">
                          {entry.endedAt
                            ? `${((entry.endedAt - entry.startedAt) / 1000).toFixed(2)}s`
                            : '…'}
                        </span>
                      </summary>
                      <div className="border-t border-zinc-800/80 px-4 py-3 space-y-3 text-left">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Arguments</div>
                          <pre className="text-xs font-mono text-zinc-300 overflow-x-auto p-3 rounded-md bg-black/40 border border-zinc-800/80">
                            {JSON.stringify(entry.args, null, 2)}
                          </pre>
                        </div>
                        {entry.error && (
                          <div>
                            <div className="text-xs uppercase tracking-wide text-red-400/90 mb-1">Error</div>
                            <pre className="text-xs font-mono text-red-300/90 whitespace-pre-wrap">{entry.error}</pre>
                          </div>
                        )}
                        {entry.result !== undefined && (
                          <div>
                            <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Result</div>
                            <pre className="text-xs font-mono text-zinc-300 max-h-80 overflow-auto p-3 rounded-md bg-black/40 border border-zinc-800/80">
                              {typeof entry.result === 'string'
                                ? entry.result
                                : JSON.stringify(entry.result, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
