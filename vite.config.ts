import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// base: 部署到 GitHub Pages 时需要设置为仓库名，例如 '/fluorolab/'
// 如果使用自定义域名或 username.github.io 根仓库，则设为 '/'
const base = process.env.GITHUB_PAGES === 'true' ? '/fluorolab/' : '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
