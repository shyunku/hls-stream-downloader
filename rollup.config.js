import eslint from "@rollup/plugin-eslint";
import json from "@rollup/plugin-json";
import typescript from "rollup-plugin-typescript2";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import packageJson from "./package.json";

const makeConfig = (inputFile, outputFile, external, runnable) => ({
  input: inputFile,
  output: {
    file: outputFile,
    format: "cjs",
    banner: runnable ? "#!/usr/bin/env node" : undefined,
    interop: "auto",
  },
  external: [
    ...external,
    ...["child_process", "fs", "os", "path", "url"],
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
  ],
  plugins: [
    nodeResolve({
      preferBuiltins: true,
    }),
    commonjs({
      include: "node_modules/**",
      transformMixedEsModules: true,
      defaultIsModuleExports: true,
    }),
    json(),
    eslint({
      throwOnError: true,
      throwOnWarning: true,
      exclude: ["node_modules/**", "**/*.json"],
    }),
    typescript({
      typescript: require("typescript"),
    }),
  ],
});

export default [
  makeConfig("src/index.ts", packageJson.main, [], false),
  makeConfig("src/cli.ts", packageJson.bin["hls-downloader"], ["./index"], true),
];
