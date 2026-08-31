import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 9999,
    proxy: {
      "/api": "http://localhost:3001",
      "/health": "http://localhost:3001",
    },
  },
  build: {
    rollupOptions: {
      // A second, unrelated page built alongside the React self-service app (still
      // one Netlify site/deploy — no extra build cost) — the public sign-up/purchase
      // widget, served at my.oaktownzouk.com/signup and iframed from
      // oaktownzouk.com/sign-up and theoaklandgrove.com/zouk. Plain TS/DOM, not
      // React: it has no auth, no shared layout with the self-service app, and needs
      // none of App.tsx's routing — see signup.html/src/signup/signup.ts.
      input: {
        main: resolve(__dirname, "index.html"),
        signup: resolve(__dirname, "signup.html"),
      },
    },
  },
});
