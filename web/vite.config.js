import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const page = (name) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  // Rutas relativas para que funcione en GitHub Pages (subcarpeta del repo).
  base: "./",
  build: {
    rollupOptions: {
      input: { main: page("index.html") },
    },
  },
});
