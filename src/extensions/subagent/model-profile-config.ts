import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {AgentModelProfile, agentModelProfiles} from "./model-profile-types";

export const autoModelProfileConfig = "auto";
export type ModelProfileConfigValue = string;
export type ModelProfileConfig = Partial<Record<AgentModelProfile, ModelProfileConfigValue>>;

const profileValues = Object.values(agentModelProfiles);

export class ModelProfileConfigStore {
  constructor(private readonly file = defaultModelProfileConfigFile()) {}

  load(): ModelProfileConfig {
    if (!fs.existsSync(this.file)) return {};
    try {
      return sanitizeModelProfileConfig(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch {
      return {};
    }
  }

  save(config: ModelProfileConfig): void {
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    fs.writeFileSync(this.file, `${JSON.stringify(sanitizeModelProfileConfig(config), null, 2)}\n`, {encoding: "utf8", mode: 0o600});
  }

  set(profile: AgentModelProfile, value: ModelProfileConfigValue): ModelProfileConfig {
    const config = this.load();
    config[profile] = normalizeConfigValue(value);
    this.save(config);
    return config;
  }

  reset(profile?: AgentModelProfile): ModelProfileConfig {
    if (!profile) {
      this.save({});
      return {};
    }
    const config = this.load();
    delete config[profile];
    this.save(config);
    return config;
  }
}

export function defaultModelProfileConfigFile(): string {
  return path.join(os.homedir(), ".pi", "agent", "model-profiles.json");
}

export function sanitizeModelProfileConfig(value: unknown): ModelProfileConfig {
  if (!isRecord(value)) return {};
  const config: ModelProfileConfig = {};
  for (const profile of profileValues) {
    const raw = value[profile];
    if (typeof raw !== "string") continue;
    const normalized = normalizeConfigValue(raw);
    if (normalized) config[profile] = normalized;
  }
  return config;
}

export function configuredModelForProfile(profile: AgentModelProfile, config = new ModelProfileConfigStore().load()): ModelProfileConfigValue {
  return config[profile] || autoModelProfileConfig;
}

export function normalizeConfigValue(value: string): ModelProfileConfigValue {
  const trimmed = value.trim();
  return trimmed === "" || trimmed.toLowerCase() === autoModelProfileConfig ? autoModelProfileConfig : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
