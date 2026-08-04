// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const DEPS_TO_OPTIMIZE = [
  "react",
  "react-dom",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "react-dom/server",
  "isbot",
  "@cloudflare/kumo",
  "@phosphor-icons/react",
  "@tanstack/react-query",
  "dompurify",
  "zustand",
  "@tiptap/react",
  "@tiptap/starter-kit",
  "@tiptap/extension-color",
  "@tiptap/extension-highlight",
  "@tiptap/extension-image",
  "@tiptap/extension-link",
  "@tiptap/extension-text-align",
  "@tiptap/extension-text-style",
  "@tiptap/extension-underline",
  "hono/cookie",
  "jose",
];

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
  resolve: {
    // Force Vite to deduplicate react packages to prevent "useContext of null" runtime error
    dedupe: ["react", "react-dom"],
  },
  // Configure pre-optimization for both the client (default) and the SSR/worker environment
  optimizeDeps: {
    include: DEPS_TO_OPTIMIZE,
  },
  environments: {
    agentic_inbox: {
      optimizeDeps: {
        include: DEPS_TO_OPTIMIZE,
      },
    },
    // Also cover "ssr" name just in case
    ssr: {
      optimizeDeps: {
        include: DEPS_TO_OPTIMIZE,
      },
    },
  },
});
