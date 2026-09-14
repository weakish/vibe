import { defineConfig } from "vite";
import melangePlugin from "vite-plugin-melange";

export default defineConfig({
  base: "./",
  plugins: [
    melangePlugin({
      emitDir: "src",
      buildCommand: "opam exec -- dune build @melange",
      watchCommand: "opam exec -- dune build --watch @melange",
    }),
  ],
  publicDir: "assets",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
