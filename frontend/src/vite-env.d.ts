/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MCP_URL?: string
  readonly VITE_MCP_RESOLVE_TIMEOUT_MS?: string
  readonly VITE_MCP_ORCHESTRATE_TIMEOUT_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
