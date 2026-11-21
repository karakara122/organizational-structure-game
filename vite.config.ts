import { defineConfig } from "vitest/config";

// base を "./" にすると、公開先のフォルダ名が何でも動く(GitHub Pages 向け)
export default defineConfig({
  base: "./",
  test: {
    include: ["src/**/*.test.ts"],
  },
});
