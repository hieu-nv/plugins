#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, relative, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PSTACK = join(ROOT, "pstack");
const SKILLS = join(PSTACK, "skills");
const GUIDE = "docs/guide";
const ADAPTER = "docs/harness/antigravity.md";
const GITHUB = "https://github.com/cursor/plugins";
const LINK = /\]\(([^)\s]+)\)/g;
const MODELS_RULE_PATH = "rules/pstack-models.md";
const DEFAULT_OUT = join(homedir(), ".gemini", "config", "plugins", "pstack");

const SUGGESTED_PROMPTS = [
  "/poteto-mode reproduce, root-cause, and fix this bug with runtime verification",
  "/architect sketch the types, signatures, and module boundaries before writing code",
  "/interrogate stress-test my current diff and keep only findings proven by running code",
];

const MODELS_RULE = `---
trigger: always_on
description: pstack per-role model choices for Antigravity (overrides skill defaults)
---

# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# \`inherit\` (or \`inherit-parent\` / \`auto\`): the role runs on the active session model (\`Model: "inherit"\` in \`invoke_subagent\`). Alias entries in a panel list still count toward its fan-out.
# Other valid Antigravity \`invoke_subagent\` \`Model\` tiers: \`pro\`, \`flash\`, \`flash_lite\`.
# defaults: 3
# budget: inherit (session model)
feature, refactoring: inherit
bug-fix: inherit
perf-issue: inherit
hillclimb: inherit
judgment and prose: inherit
arena runners: inherit, inherit, inherit
arena cross-judge pool: inherit
swarm workers: inherit
interrogate reviewers: inherit, inherit, inherit
`;

const TERMS = [
  { key: "`Task`", re: /`Task`|\bTask (tool|subagent|call)/ },
  { key: "`AskQuestion`", re: /AskQuestion/ },
  { key: "todolist", re: /\btodo ?list\b/i },
  { key: "generalPurpose", re: /generalPurpose/ },
  { key: "poteto-agent", re: /poteto-agent/ },
  { key: "comment-sicko", re: /comment-sicko/ },
  { key: "`readonly: true`", re: /readonly: (true|false)|readonly\/Ask/ },
  { key: "`environment: \"cloud\"`", re: /environment: "(cloud|local)"/ },
  { key: "cloud_base_branch", re: /cloud_base_branch/ },
  { key: "`run_in_background: true`", re: /run_in_background/ },
  { key: "`resume`", re: /`resume`/ },
  { key: "`file_attachments`", re: /file_attachments/ },
  { key: "claude-", re: /\bclaude-[a-z]+-\d/ },
  { key: "grok-", re: /\bgrok-\d/ },
  { key: "gpt-", re: /\bgpt-\d/ },
  { key: "inherit-parent", re: /inherit-parent/ },
  { key: "pstack-models.mdc", re: /pstack-models\.mdc/ },
  { key: ".cursor/skills/", re: /\.cursor\/skills/ },
  { key: "~/.cursor/plugins/", re: /\.cursor\/plugins|\.cursor-plugin/ },
  { key: ".cursor/rules/", re: /\.cursor\/rules|always-applied rule/ },
  { key: "agent-transcripts", re: /agent-transcripts|\.cursor\/projects/ },
  { key: "Cursor-only features", re: /Bugbot|Cursor [Aa]utomation|cursor\.(sh|com)\/automations|[Cc]loud [Aa]gent|built-in PR tool/ },
];
const ROUTE_KEY = "Run another pstack skill";
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function printUsage() {
  console.log(`Usage: node scripts/install-pstack-antigravity.mjs [options]

Render pstack/ directly into an Antigravity plugin directory without checking
a duplicated harness tree into git.

Options:
  --out <dir>     Target plugin directory (default: ${DEFAULT_OUT})
  --check         Validate pstack/ against ${ADAPTER} without writing files
  --reset-models  Overwrite existing ${MODELS_RULE_PATH} with the default template
  -h, --help      Show this help`);
}

function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
}

function parseArgs(argv) {
  let outDir = DEFAULT_OUT;
  let check = false;
  let resetModels = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (arg === "--check") {
      check = true;
    } else if (arg === "--reset-models") {
      resetModels = true;
    } else if (arg === "--out") {
      const next = argv[++i];
      if (!next) {
        console.error("ERROR: --out requires a directory path");
        process.exit(1);
      }
      outDir = resolvePath(expandHome(next));
    } else if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length);
      if (!value) {
        console.error("ERROR: --out requires a directory path");
        process.exit(1);
      }
      outDir = resolvePath(expandHome(value));
    } else {
      console.error(`ERROR: unknown argument ${JSON.stringify(arg)}`);
      printUsage();
      process.exit(1);
    }
  }
  return { outDir, check, resetModels };
}

function toPosix(path) {
  return sep === "/" ? path : path.split(sep).join("/");
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === ".DS_Store" || name === "node_modules") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function readEntry(path) {
  return { bytes: readFileSync(path), executable: (statSync(path).mode & 0o111) !== 0 };
}

function mapPath(path) {
  if (path === "skills/swarm") return "skills/pstack-swarm";
  if (path.startsWith("skills/swarm/")) return `skills/pstack-swarm/${path.slice("skills/swarm/".length)}`;
  return path;
}

// The pstack-relative path that a relative link in `from` points at, if that path exists.
function resolveInPstack(from, href) {
  const target = href.replace(/[#?].*/, "");
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return undefined;
  const path = posix.join(posix.dirname(from), target).replace(/\/$/, "");
  return existsSync(join(PSTACK, path)) ? path : undefined;
}

function has(files, path) {
  return files.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`));
}

function renderManifest(source) {
  const manifest = {
    $schema: "https://antigravity.google/schemas/v1/plugin.json",
    name: source.name,
    displayName: source.name,
    version: source.version,
    description: source.description,
    author: source.author,
    homepage: source.homepage,
    repository: source.repository,
    license: source.license,
    keywords: source.keywords,
    logo: "assets/logo.png",
    suggestedPrompts: SUGGESTED_PROMPTS,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function adaptAgent(path, text) {
  const adapterNote = `In Antigravity, read [the Antigravity adapter](../${ADAPTER}) once per session alongside any skill you load.`;
  if (path === "agents/poteto-agent.md") {
    const frontmatter = [
      "---",
      "name: poteto-agent",
      "description: Delegate subagent for code-writing and helper tasks spawned during a `/poteto-mode` run. Use for delegates, not as the runner for `/poteto-mode` itself. Spawn a fresh `poteto-agent` for each new task, and resume one only in the strict cases that poteto-mode's Subagents section names. Reads the `poteto-mode` skill's `SKILL.md` in full before any work, including its inline Principles index. Substituting `self` skips that read and drifts.",
      "subagent: true",
      "mainAgent: false",
      "tools:",
      "  - read_file",
      "  - edit_file",
      "  - write_file",
      "  - run_command",
      "  - manage_task",
      "  - search_web",
      "  - send_message",
      "---",
    ].join("\n");
    const body = text
      .replace(/^---\n[\s\S]*?\n---\n+/, "")
      .replace(
        /^(# .*)\n+/m,
        `$1\n\n${adapterNote} With no path from your parent, check \`~/.gemini/config/plugins/pstack/skills/poteto-mode/SKILL.md\` first (or search \`~/.gemini/config/plugins/\` by \`plugin.json\` \`version\`) before searching \`~/.cursor/plugins/\`.\n\n`,
      );
    return `${frontmatter}\n\n${body}`;
  }
  if (path === "agents/comment-sicko.md") {
    const frontmatter = [
      "---",
      "name: comment-sicko",
      "description: A deranged comment-hater that savors deletion and condemns workaround code.",
      "subagent: true",
      "mainAgent: false",
      "tools:",
      "  - read_file",
      "  - edit_file",
      "  - run_command",
      "  - manage_task",
      "  - send_message",
      "---",
    ].join("\n");
    const body = text
      .replace(/^---\n[\s\S]*?\n---\n+/, "")
      .replace(/^(# .*)\n+/m, `$1\n\n${adapterNote}\n\n`);
    return `${frontmatter}\n\n${body}`;
  }
  return text;
}

function buildBundle() {
  const skills = readdirSync(SKILLS).filter((name) => existsSync(join(SKILLS, name, "SKILL.md")));

  function classify(skill) {
    const dir = join(SKILLS, skill);
    const others = skills.filter((name) => name !== skill).join("|");
    const route = new RegExp(`the \\*\\*(?<bold>${others})\\*\\* skill|\`/(?<command>${others})\``, "g");
    const linksToSkill = (line, name) => line.includes(`(../${name}/`);
    const namesBareSkill = (line) =>
      [...line.matchAll(route)].some(({ groups }) => !linksToSkill(line, groups.bold ?? groups.command));
    const usesCursorNames = new Set();
    for (const path of walk(dir).filter((path) => path.endsWith(".md"))) {
      const text = readFileSync(path, "utf8");
      for (const term of TERMS) if (term.re.test(text)) usesCursorNames.add(term.key);
      if (text.split("\n").some(namesBareSkill)) usesCursorNames.add(ROUTE_KEY);
    }
    const text = readFileSync(join(dir, "SKILL.md"), "utf8");
    const wrap = usesCursorNames.size > 0 && /^# /m.test(text);
    return { usesCursorNames, wrap };
  }

  const classes = new Map(skills.map((skill) => [skill, classify(skill)]));
  const problems = [];
  const users = new Map();
  for (const [skill, { usesCursorNames, wrap }] of classes) {
    if (usesCursorNames.size > 0 && !wrap) problems.push(`skills/${skill}/SKILL.md uses Cursor names but has no H1`);
    for (const key of usesCursorNames) users.set(key, [...(users.get(key) ?? []), skill]);
    const frontmatter = readFileSync(join(SKILLS, skill, "SKILL.md"), "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const name = frontmatter.match(/^name:(.*)$/m)?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (name !== skill) problems.push(`skills/${skill}/SKILL.md has name ${JSON.stringify(name ?? "")}, not its folder name ${skill}`);
    if (!SKILL_NAME.test(skill) || skill.length > 64) {
      problems.push(`skills/${skill} is not lowercase words joined by hyphens, at most 64 characters`);
    }
  }

  const adapterText = readFileSync(join(PSTACK, ADAPTER), "utf8");
  for (const [key, using] of users) {
    if (!adapterText.includes(key)) problems.push(`Antigravity adapter has no row for ${key}, used by ${using.join(", ")}`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    process.exit(1);
  }

  const copies = [
    ...walk(SKILLS),
    ...walk(join(PSTACK, "agents")),
    ...walk(join(PSTACK, GUIDE)),
    join(PSTACK, ADAPTER),
    join(PSTACK, "README.md"),
  ];
  const sourcePaths = new Map();
  const files = new Map(
    copies.map((absPath) => {
      const srcRel = toPosix(relative(PSTACK, absPath));
      const outRel = mapPath(srcRel);
      sourcePaths.set(outRel, srcRel);
      return [outRel, readEntry(absPath)];
    }),
  );

  const adapterLine =
    `In Antigravity, read [the Antigravity adapter](../../${ADAPTER}) once per session before you follow this skill. ` +
    `It maps the Cursor names in pstack skills to Antigravity.`;

  for (const [skill, { wrap }] of classes) {
    const outSkill = skill === "swarm" ? "pstack-swarm" : skill;
    const path = `skills/${outSkill}/SKILL.md`;
    let text = files.get(path).bytes.toString("utf8");
    if (skill === "swarm") {
      text = text.replace(
        /^---\n([\s\S]*?)\n---/,
        (_, fm) =>
          `---\n${fm
            .replace(/^name:\s*swarm$/m, "name: pstack-swarm")
            .replace(
              /^description:.*$/m,
              'description: "Fan out N parallel workers, drain them, and return one report. Use for /pstack-swarm, \'pstack swarm\', or pstack parallel coverage, races, gauntlets, and exploration."',
            )}\n---`,
      );
    }
    if (!skill.startsWith("principle-")) {
      text = text.replace(/^---\n([\s\S]*?)\n---/, (_, fm) => {
        const filtered = fm
          .split("\n")
          .filter((line) => !/^disable-model-invocation\s*:/.test(line))
          .join("\n");
        return `---\n${filtered}\n---`;
      });
    }
    if (wrap) text = text.replace(/^(# .*)\n+/m, `$1\n\n${adapterLine}\n\n`);
    files.get(path).bytes = Buffer.from(text);
  }

  for (const agentPath of ["agents/poteto-agent.md", "agents/comment-sicko.md"]) {
    const entry = files.get(agentPath);
    if (entry) entry.bytes = Buffer.from(adaptAgent(agentPath, entry.bytes.toString("utf8")));
  }

  const sourceManifest = JSON.parse(readFileSync(join(PSTACK, "plugin.json"), "utf8"));
  files.set("assets/logo.png", readEntry(join(PSTACK, "assets", "logo.png")));
  files.set(MODELS_RULE_PATH, { bytes: Buffer.from(MODELS_RULE), executable: false });
  files.set("plugin.json", { bytes: Buffer.from(renderManifest(sourceManifest)), executable: false });
  files.set("LICENSE", readEntry(join(PSTACK, "LICENSE")));

  for (const [path, entry] of files) {
    if (!path.endsWith(".md")) continue;
    const srcFrom = sourcePaths.get(path) ?? path;
    const text = entry.bytes.toString("utf8").replace(LINK, (link, href) => {
      const target = resolveInPstack(srcFrom, href);
      if (!target || target.split("/")[0] === "..") return link;
      const mapped = mapPath(target);
      const suffix = href.slice(href.search(/[#?]|$/));
      if (has(files, mapped)) {
        if (mapped === target) return link;
        let rel = posix.relative(posix.dirname(path), mapped) || ".";
        if (href.startsWith("./") && !rel.startsWith(".")) rel = `./${rel}`;
        if (href.replace(/[#?].*/, "").endsWith("/") && !rel.endsWith("/")) rel = `${rel}/`;
        return `](${rel}${suffix})`;
      }
      const kind = statSync(join(PSTACK, target)).isDirectory() ? "tree" : "blob";
      return `](${GITHUB}/${kind}/main/pstack/${target}${suffix})`;
    });
    entry.bytes = Buffer.from(text);
  }

  const dangling = [];
  for (const [path, entry] of files) {
    if (!path.endsWith(".md")) continue;
    const srcFrom = sourcePaths.get(path) ?? path;
    for (const [, href] of entry.bytes.toString("utf8").matchAll(LINK)) {
      const stripped = href.replace(/[#?].*/, "");
      if (!stripped || /^[a-z][a-z0-9+.-]*:/i.test(stripped)) continue;
      const inTreeTarget = posix.normalize(posix.join(posix.dirname(path), stripped)).replace(/\/$/, "");
      if (has(files, inTreeTarget)) continue;
      const pstackTarget = resolveInPstack(srcFrom, href);
      if (pstackTarget) dangling.push(`${path} links to ${href}, which is not in the rendered bundle`);
    }
  }
  if (dangling.length > 0) {
    for (const link of dangling) console.error(`FAIL ${link}`);
    process.exit(1);
  }

  const wrapped = [...classes.values()].filter(({ wrap }) => wrap).length;
  return { files, version: sourceManifest.version, skillCount: skills.length, wrapped };
}

function assertSafeTarget(outDir) {
  const forbidden = new Set([
    resolvePath("/"),
    resolvePath(homedir()),
    resolvePath(join(homedir(), ".gemini")),
    resolvePath(join(homedir(), ".gemini", "config")),
    resolvePath(join(homedir(), ".gemini", "config", "plugins")),
    resolvePath(ROOT),
    resolvePath(PSTACK),
  ]);
  if (forbidden.has(resolvePath(outDir))) {
    console.error(`ERROR: refusing to sync unsafe target directory: ${outDir}`);
    process.exit(1);
  }
}

function pruneStale(dir, rootDir, expected) {
  let removed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += pruneStale(abs, rootDir, expected);
      if (readdirSync(abs).length === 0) rmdirSync(abs);
    } else {
      const rel = toPosix(relative(rootDir, abs));
      if (!expected.has(rel)) {
        rmSync(abs, { force: true });
        removed++;
      }
    }
  }
  return removed;
}

function syncBundle(outDir, files, resetModels) {
  assertSafeTarget(outDir);
  const modelsAbs = join(outDir, MODELS_RULE_PATH);
  let preservedModels = false;
  if (!resetModels && existsSync(modelsAbs)) {
    files.set(MODELS_RULE_PATH, readEntry(modelsAbs));
    preservedModels = true;
  }

  mkdirSync(outDir, { recursive: true });
  for (const [rel, { bytes, executable }] of files) {
    const abs = join(outDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    chmodSync(abs, executable ? 0o755 : 0o644);
  }
  const removed = pruneStale(outDir, outDir, files);
  return { preservedModels, removed };
}

const { outDir, check, resetModels } = parseArgs(process.argv.slice(2));
const { files, version, skillCount, wrapped } = buildBundle();

if (check) {
  console.log(`pstack ${version} Antigravity bundle check passed (${skillCount} skills, ${wrapped} wrapped with adapter link).`);
  process.exit(0);
}

const { preservedModels, removed } = syncBundle(outDir, files, resetModels);
const modelsNote = preservedModels ? `preserved existing ${MODELS_RULE_PATH}` : `wrote default ${MODELS_RULE_PATH}`;
const removedNote = removed > 0 ? `, removed ${removed} stale file(s)` : "";
console.log(`Installed pstack ${version} for Antigravity to ${outDir} (${skillCount} skills, ${wrapped} wrapped, ${modelsNote}${removedNote}).`);
