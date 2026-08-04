// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Stubs out @cloudflare/kumo in the SSR (workerd) environment.
 *
 * @cloudflare/kumo is a browser-only component library. It pulls in `shiki`
 * which dynamically fetches language grammars — those fetch() calls fail
 * inside the Cloudflare workerd runtime, crashing the dev SSR runner.
 *
 * In SSR we only need a structural HTML shell; the real kumo components
 * hydrate on the client. So we replace every kumo export with a minimal
 * pass-through stub that renders its children (or nothing).
 */
function kumoSsrStub(): Plugin {
  const STUB_ID = "\0kumo-ssr-stub";

  // All named exports used across the app
  const COMPONENT_STUBS = [
    "Badge",
    "Banner",
    "Button",
    "Dialog",
    "Empty",
    "Input",
    "Loader",
    "Pagination",
    "Select",
    "Text",
    "Tooltip",
    "TooltipContent",
    "TooltipTrigger",
    "LinkProvider",
    "Toasty",
    "TooltipProvider",
  ];

  const HOOK_STUBS = [
    "useKumoToastManager",
  ];

  return {
    name: "kumo-ssr-stub",
    enforce: "pre",
    resolveId(source, _importer, options) {
      // Only stub in the SSR environment (workerd)
      if (source === "@cloudflare/kumo" && options?.ssr) {
        return STUB_ID;
      }
    },
    load(id) {
      if (id !== STUB_ID) return;

      const lines = [
        `import { createElement, Fragment } from "react";`,
        `const _Pass = ({children}) => createElement(Fragment, null, children ?? null);`,
        `const _Null = () => null;`,
        `const _Hook = () => ({ addToast: () => {}, removeToast: () => {} });`,
        "",
        // Component stubs — render children if they have them, null otherwise
        ...COMPONENT_STUBS.map(
          (name) => `export const ${name} = _Pass;`
        ),
        // Hook stubs — return empty objects
        ...HOOK_STUBS.map(
          (name) => `export const ${name} = _Hook;`
        ),
      ];

      return lines.join("\n");
    },
  };
}

export default defineConfig({
  plugins: [
    kumoSsrStub(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
