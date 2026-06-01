import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {renderSubagentTree} from "./render";
import {SubagentNode} from "./types";

export async function writeSubagentNodeFile(treeDir: string | undefined, node: SubagentNode): Promise<void> {
  if (!treeDir) return;
  await fsp.mkdir(treeDir, {recursive: true});
  const target = nodeFile(treeDir, node.id);
  const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(node)}\n`, "utf8");
  await fsp.rename(temp, target);
}

export function renderSubagentTreeFromFiles(treeDir: string | undefined, rootId: string): string[] {
  if (!treeDir) return [];
  const nodes = readSubagentNodes(treeDir);
  const root = nodes.get(rootId);
  if (!root) return [];
  return renderSubagentTree(root, (id) => nodes.get(id));
}

export async function cleanupSubagentTreeDir(treeDir: string | undefined): Promise<void> {
  if (!treeDir) return;
  await fsp.rm(treeDir, {recursive: true, force: true});
}

function readSubagentNodes(treeDir: string): Map<string, SubagentNode> {
  const nodes = new Map<string, SubagentNode>();
  let entries: string[];
  try {
    entries = fs.readdirSync(treeDir);
  } catch {
    return nodes;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(treeDir, entry), "utf8");
      const node = JSON.parse(raw) as SubagentNode;
      nodes.set(node.id, {...node, children: []});
    } catch {
      // Ignore partially written or invalid files.
    }
  }

  for (const node of nodes.values()) {
    if (!node.parentId) continue;
    const parent = nodes.get(node.parentId);
    if (parent && !parent.children.includes(node.id)) parent.children.push(node.id);
  }

  for (const node of nodes.values()) node.children.sort(compareLineageIds);
  return nodes;
}

function nodeFile(treeDir: string, id: string): string {
  return path.join(treeDir, `${id.replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`);
}

function compareLineageIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, {numeric: true});
}
