// The SSR contract test imports the built Worker in Node. Its Workflow class is
// exported for Cloudflare, but never instantiated by the SSR request.
import { access } from "node:fs/promises";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: "data:text/javascript,export class WorkflowEntrypoint {}; export const env = {}", shortCircuit: true };
  }
  const workspace = new URL("../", import.meta.url);
  const base = specifier.startsWith("@/") ? new URL(specifier.slice(2), workspace) : specifier.startsWith(".") && context.parentURL?.startsWith(workspace.href) && !context.parentURL.includes("node_modules") ? new URL(specifier, context.parentURL) : null;
  if (base && !/\.[a-z]+$/i.test(base.pathname)) {
    for (const suffix of [".ts", "/index.ts"]) {
      const target = new URL(`${base.href}${suffix}`);
      try { await access(target); return { url: target.href, shortCircuit: true }; }
      catch { /* Try the next source module path. */ }
    }
  }
  return nextResolve(specifier, context);
}
