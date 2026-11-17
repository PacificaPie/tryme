import vinext from "vinext";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";
import { sites } from "./scripts/vite/sites-vite-plugin";
import { connectorPreview } from "./scripts/vite/connector-preview-plugin.mjs";
import { isLoopbackOrigin, readStandaloneConfig, standaloneConfigPath, standaloneState } from "./scripts/standalone-config.mjs";
import { standaloneFrameworkPlugins, standaloneIsolationPlugin } from "./scripts/standalone-vite.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const standalone = process.env.FUNTRACK_TARGET === "standalone";
if (process.env.FUNTRACK_TARGET && !["sites", "standalone"].includes(process.env.FUNTRACK_TARGET)) throw new Error("Unknown FUNTRACK_TARGET.");
// The independent target does not need the Sites hosting descriptor.
const { d1, r2 } = standalone ? {} : JSON.parse(readFileSync(new URL("./.openai/hosting.json", import.meta.url), "utf8"));

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  configureToolEnvironment(process.cwd());

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const independentConfig = standalone ? readStandaloneConfig() : null;
  const standalonePort = Number(process.env.FUNTRACK_STANDALONE_PORT || 8787);
  if (standalone && command === "serve" && !isLoopbackOrigin(independentConfig.vars?.APP_ORIGIN)) throw new Error("Use a local standalone configuration for development.");
  const framework = vinext(standalone ? {
    rscOutDir: "dist-standalone/server",
    ssrOutDir: "dist-standalone/server/ssr",
    clientOutDir: "dist-standalone/client",
  } : undefined);

  return {
    ...(standalone ? {
      envDir: false as const,
      // vinext's CommonJS transform skips node_modules. Optimized ESM kept
      // outside it can be transformed twice and gain a second default export.
      cacheDir: "node_modules/.vite-funtrack-standalone",
      build: { outDir: "dist-standalone" },
      environments: {
        client: { build: { outDir: "dist-standalone/client" } },
        rsc: { build: { outDir: "dist-standalone/server" } },
        ssr: { build: { outDir: "dist-standalone/server/ssr" } },
      },
    } : {}),
    server: {
      ...(standalone ? { host: "127.0.0.1", port: standalonePort, strictPort: true, allowedHosts: ["127.0.0.1", "localhost"] } : managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      ...(standalone ? await standaloneFrameworkPlugins(framework) : framework),
      ...(standalone ? [standaloneIsolationPlugin()] : [sites({ mockAuth: !managedLinux }), connectorPreview()]),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        ...(standalone ? {
          configPath: standaloneConfigPath(),
          remoteBindings: false,
          persistState: { path: standaloneState },
          config: {
            main: path.resolve("worker/standalone.ts"),
            ...(command === "serve" ? { vars: { ...independentConfig.vars, APP_ORIGIN: `http://127.0.0.1:${standalonePort}` } } : {}),
          },
        } : { config: {
          ...localBindingConfig,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        } }),
        ...(!standalone && command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./scripts/connector-preview/worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
