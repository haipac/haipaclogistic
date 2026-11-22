import path from "node:path";
import { build } from "esbuild";

const serverOnlyStub = {
  name: "server-only-stub",
  setup(buildContext) {
    buildContext.onResolve({ filter: /^server-only$/ }, () => ({
      path: "server-only",
      namespace: "server-only-stub",
    }));
    buildContext.onLoad({ filter: /.*/, namespace: "server-only-stub" }, () => ({
      contents: "export {};",
      loader: "js",
    }));
  },
};

await build({
  entryPoints: ["src/index.ts", "src/api.ts"],
  outdir: "lib",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
  tsconfig: "tsconfig.json",
  plugins: [serverOnlyStub],
});

await build({
  entryPoints: ["src/email-index.ts"],
  outfile: path.resolve("../email-functions/lib/index.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
  tsconfig: "tsconfig.json",
  plugins: [serverOnlyStub],
});
