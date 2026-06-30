import { defineConfig } from 'vite';

// allowedHosts: true is fine here because this only affects the local dev
// server (used behind a throwaway cloudflared tunnel for phone testing),
// not the static production build served from GitHub Pages.
export default defineConfig({
  base: '/munro-horizon/',
  server: {
    allowedHosts: true,
  },
});
