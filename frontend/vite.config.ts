import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const DEFAULT_MCP_URL = 'http://127.0.0.1:8000/mcp'

function mcpProxyTarget(env: Record<string, string>): string {
  const raw = env.VITE_MCP_URL?.trim() || DEFAULT_MCP_URL
  try {
    return new URL(raw).origin
  } catch {
    return new URL(DEFAULT_MCP_URL).origin
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/mcp': {
          target: mcpProxyTarget(env),
          changeOrigin: true,
        },
      },
    },
  }
})
