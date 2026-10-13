import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

// `npm run dev:h5` serves the app from Vite; API and realtime calls go to the chat server.
const target = process.env.FEEOF_SERVER || 'http://localhost:3000';

export default defineConfig({
  plugins: [uni()],
  server: {
    proxy: {
      '/api': { target, changeOrigin: true },
      '/uploads': { target, changeOrigin: true },
      '/socket.io': { target, changeOrigin: true, ws: true },
    },
  },
});
