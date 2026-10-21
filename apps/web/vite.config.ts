import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Strict CSP in the production build only: dev needs inline scripts for React refresh.
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'";
function cspInBuild(): Plugin {
  return {
    name: 'csbot-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
    },
  };
}

export default defineConfig({
  // Relative asset paths: works on GitHub Pages under /csbot/ and from file:// in Electron.
  base: './',
  plugins: [react(), cspInBuild()],
  build: { target: 'es2022', sourcemap: true },
  server: { port: 4316, strictPort: true },
  preview: { port: 4317, strictPort: true },
});
