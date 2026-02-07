import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

const resolveVersionMinor = () => {
  try {
    const versionsPath = path.join(rootDir, 'public', 'versions.txt')
    if (!fs.existsSync(versionsPath)) return 0
    const lastUpdateCommit = execSync('git log -n 1 --format=%H -- public/versions.txt', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    if (!lastUpdateCommit) return 0
    const count = execSync(`git rev-list --count ${lastUpdateCommit}..HEAD`, {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    const minor = Number(count)
    return Number.isFinite(minor) ? minor : 0
  } catch {
    return 0
  }
}

const versionMinor = resolveVersionMinor()

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_VERSION_MINOR': JSON.stringify(versionMinor),
  },
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    host: true,
  },
})
