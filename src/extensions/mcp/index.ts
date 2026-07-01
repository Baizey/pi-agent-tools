import {PiExtensionApi} from "../../pi/types";
import {McpManager} from "./client";
import {McpConfigStore} from "./config";
import {registerMcpCommand} from "./commands";
import {McpToolRegistry} from "./tools";

export type McpExtensionServices = {
  store?: McpConfigStore;
  manager?: McpManager;
  registry?: McpToolRegistry;
};

export function registerMcpExtension(pi: PiExtensionApi, services: McpExtensionServices = {}): void {
  const store = services.store ?? new McpConfigStore();
  const manager = services.manager ?? new McpManager(store.load());
  const registry = services.registry ?? new McpToolRegistry(pi, manager, store);

  pi.on?.("session_start", async (_event, ctx) => {
    manager.setBaseCwd(ctx.cwd ?? process.cwd());
    const config = store.load();
    manager.updateConfig(config);
    await manager.connectAuto(ctx.signal).catch(() => undefined);
    registry.registerAvailableTools(config);
  });

  pi.on?.("session_shutdown", async () => {
    await manager.disconnectAll();
  });

  registerMcpCommand(pi, {store, manager, registry});
}

export * from "./client";
export * from "./commands";
export * from "./config";
export * from "./tools";
export * from "./types";
