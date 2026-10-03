// SSR 冒烟：验证整个 React 组件树（含 store/provider）首次渲染不抛错
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

mkdirSync("node_modules/.cache", { recursive: true });
const virtual = `
import React from "react";
import { renderToString } from "react-dom/server";
import App from ${JSON.stringify(process.cwd() + "/src/App.tsx")};
const html = renderToString(React.createElement(App));
if (!html.includes("洁净室粒子计数链路")) throw new Error("页面主标题缺失");
if (!html.includes("TK-OPC-Y031-118")) throw new Error("期望的幂等工单未渲染");
if (!html.includes("本机待补传")) throw new Error("待补传区未渲染");
if (html.length < 5000) throw new Error("渲染内容过少: " + html.length);
console.log("SSR 渲染成功，HTML 长度:", html.length);
`;
writeFileSync("node_modules/.cache/ssr-entry.tsx", virtual);

await build({
  entryPoints: ["node_modules/.cache/ssr-entry.tsx"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "node_modules/.cache/ssr.cjs",
  jsx: "automatic",
  logLevel: "warning",
  plugins: [
    {
      name: "stub-css",
      setup(b) {
        b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: "css-stub" }));
        b.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({ contents: "", loader: "js" }));
      },
    },
  ],
});

createRequire(import.meta.url)("./node_modules/.cache/ssr.cjs");
