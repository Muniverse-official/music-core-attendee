import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const destination = resolve(process.argv[2] ?? "../../site/finger-king");
await mkdir(destination, { recursive: true });
await build({
  entryPoints: { public: "ui/entry/public.tsx", admin: "ui/entry/admin.tsx" },
  bundle: true,
  minify: true,
  jsx: "automatic",
  outdir: destination,
});
await build({
  entryPoints: { "admin-embed": "ui/entry/admin-embed.tsx" },
  bundle: true,
  minify: true,
  jsx: "automatic",
  format: "esm",
  outdir: destination,
});
await Promise.all([
  cp("templates", destination, { recursive: true }),
  cp("ui/public/assets", resolve(destination, "assets"), { recursive: true }),
]);
