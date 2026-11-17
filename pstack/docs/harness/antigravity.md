# pstack in Antigravity

pstack skills use Cursor names. In Antigravity, read this file once per session, then map each Cursor name in a skill with the tables below. `<pstack>` means the installed plugin folder (`~/.gemini/config/plugins/pstack` when installed globally) that holds `skills/`, `agents/`, `rules/`, and `docs/`. If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

## Tools

| Cursor | Antigravity |
| --- | --- |
| `Task` | `invoke_subagent` (pass `TypeName`, a 2-5 word `Role`, `Prompt`, and optional `Workspace` and `Model`). For scripted multi-agent pipelines or large array fan-outs, `run_workflow` (`parallel`, `pipeline`) is also available. Do not confuse pstack's `pstack-swarm` skill with Antigravity's built-in `swarm` message-board tool unless the user explicitly asks for a board swarm. |
| `AskQuestion` | `ask_question` (omit numbering and an `Other` option, and prefix a recommended first choice with `(Recommended)`). For trivial yes-or-no questions or non-interactive runs, ask in plain text. |
| Open a todolist, or copy steps into the todolist tool | Create or update `<Artifact Directory Path>/task.md` (`write_file` or `edit_file` with `ArtifactMetadata`) on multi-step tasks, or keep the checklist inline in your reply on short runs and update it at each phase. |
| Run another pstack skill (`/name` or "the **name** skill") | `read_file` `<pstack>/skills/<name>/SKILL.md` and follow it. Exception: pstack's `swarm` skill lives at `<pstack>/skills/pstack-swarm/SKILL.md` (`name: pstack-swarm`) so it does not shadow Antigravity's built-in `swarm` skill. Map `/swarm` or "the **swarm** skill" inside a pstack workflow to `<pstack>/skills/pstack-swarm/SKILL.md`. All 34 command skills auto-discover in Antigravity, while the 24 `principle-*` skills stay on demand (`disable-model-invocation: true`). In the Antigravity CLI, tell the user to type `/pstack:<name>` (or `/pstack:pstack-swarm`). |
| `Grep`, `Glob` | `run_command` with `rg` or `fd` (or `find`), and `read_file` to read files. |

## Subagent fields

| Cursor | Antigravity |
| --- | --- |
| `subagent_type: generalPurpose` | `TypeName: "self"` |
| `poteto-agent`, `comment-sicko` | `TypeName: "poteto-agent"`, `TypeName: "comment-sicko"`. Always include the absolute path to `<pstack>/skills/poteto-mode/SKILL.md` in every `poteto-agent` `Prompt`, and start any delegate or Project worker kickoff with `Read <pstack>/skills/poteto-mode/worker.md before anything else.` when `poteto-mode` asks for it. |
| The `model:` line in `poteto-agent`'s file | The Antigravity bundle drops Cursor's `model:` line from `agents/poteto-agent.md`, so `TypeName: "poteto-agent"` always uses the `Model` passed to `invoke_subagent` (or the active session model when omitted). You do not need to replace `poteto-agent` with `self` when a role is set to `inherit`, `inherit-parent`, or `auto`. |
| `readonly: true` | `TypeName: "research"` for pure file and codebase exploration (runs in a read-only sandbox with no shell or network). When a readonly check must run git, tests, or `gh` commands (such as `/why` or PR checks), use `TypeName: "self"`, state `"do not edit files"` in `Prompt`, and check `git status` afterward. |
| `readonly: false` | `TypeName: "self"` (or `TypeName: "poteto-agent"` for a poteto delegate). It inherits the session's tools and MCP servers. |
| `environment: "cloud"` | `Workspace: "share"` (new working copy that shares the underlying git repository, similar to a worktree) or `Workspace: "branch"` (isolated clone). Name the branch or commit that the worker checks out in `Prompt`. |
| `environment: "local"` | `Workspace: "inherit"` (or omit `Workspace`). |
| `cloud_base_branch: <b>` | Pass `Workspace: "share"` (or `"branch"`) and tell the worker in `Prompt` to check out `<b>` first. |
| `run_in_background: true` | Omit. `invoke_subagent` runs in the background by default and wakes your turn when the subagent sends a message or finishes. Never poll in a loop. |
| `resume` | `send_message` with `Recipient: "<conversationId>"` and `Message: "..."` when new work strictly needs state inside that subagent. Otherwise start a fresh subagent via `invoke_subagent` with consolidated scope. |
| `file_attachments` | List absolute file paths in `Prompt`. When delegating to the `browser` subagent, stage files for inspection in `<Artifact Directory Path>/browser_sandbox/references/<filename>` and files for upload in `<Artifact Directory Path>/browser_sandbox/uploads/<filename>`. |

## Models

| Cursor | Antigravity |
| --- | --- |
| `claude-<family>-<version>-<effort>[-fast]`, `gemini-*`, `gpt-*`, or `grok-*` slugs, such as `claude-opus-5-5-xhigh-fast`, `claude-fable-5-2-high`, or `gemini-4-neon-xhigh` | Read the role's configured tier from `~/.gemini/config/plugins/pstack/rules/pstack-models.md`. `invoke_subagent` `Model` accepts only `"inherit"`, `"pro"`, `"flash"`, or `"flash_lite"`. By default every role is `inherit` (omit `Model` or pass `Model: "inherit"` so the subagent uses the active session model). Never switch models on your own after quota or availability errors. Report the error to the user first. |
| `auto`, `inherit-parent`, or `inherit` | Omit `Model` (or pass `Model: "inherit"`). In `arena` Phase C (`arena cross-judge pool`), `inherit`, `inherit-parent`, and `auto` all refer to the parent session model. When no non-parent tier is configured, skip the cross-judge and state that Phase C skipped the judge. |
| The `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | `~/.gemini/config/plugins/pstack/rules/pstack-models.md` (`trigger: always_on`). Antigravity loads this rule while the `pstack` plugin is enabled. If its lines are not in context, read that file. If the file or the role's line is missing, use `inherit`. |
| A role value `inherit`, `pro`, `flash`, or `flash_lite` | Pass `Model: "<value>"` to `invoke_subagent` (or omit `Model` when `inherit`). For panel roles (`arena runners`, `interrogate reviewers`), start one subagent per comma-separated entry so list length sets fan-out count. |

## setup-pstack

Antigravity loads `rules/pstack-models.md` from `~/.gemini/config/plugins/pstack/rules/pstack-models.md` while the `pstack` plugin is enabled, so `setup-pstack` writes its rule there. Follow its steps with these changes:

- Detect. The valid `invoke_subagent` `Model` values are `inherit` (active session model), `pro`, `flash`, and `flash_lite`. `auto` and `inherit-parent` remain valid aliases for `inherit`.
- Defaults and budget. Offer `(Recommended) inherit (active session model for all roles)` first in `ask_question`, alongside tiered budgets (`large (pro for deep roles, flash for workers)`, `medium (inherit for deep roles, flash for workers)`, `small (flash for deep roles, flash_lite for workers)`). Under the default `inherit` budget, set single-model roles and `arena cross-judge pool` to `inherit`, and set multi-runner panel roles (`arena runners`, `interrogate reviewers`) to `inherit, inherit, inherit` so fan-out stays at three runners. Drop retired roles not in step 5 (`hardest tasks`, `architect runners`, `reflect tooling`, `reflect judgment, divergent, synthesizer`, `why investigators`).
- Write. Write `~/.gemini/config/plugins/pstack/rules/pstack-models.md` starting with YAML frontmatter (`trigger: always_on` and `description`), then the comment lines, `# defaults: 3`, `# budget: ...`, and one line per role from step 5. Overwrite the whole file. Never write role lines into `GEMINI.md` or `AGENTS.md`.

## Paths

| Cursor | Antigravity |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `.agents/skills/`, `~/.gemini/config/skills/` |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json`, `plugins/cache/` | `~/.gemini/config/plugins/`, `plugin.json`. For durable skill edits from `/reflect`, copy the skill to `.agents/skills/<skill>/` or `~/.gemini/config/skills/<skill>/`, or edit the source repository and re-run `node scripts/install-pstack-antigravity.mjs`. |
| `.cursor/rules/*.mdc`, always-applied rules | `.agents/rules/*.md` (`trigger: always_on`), `AGENTS.md`, or `GEMINI.md`. The model rule is the exception and lives at `~/.gemini/config/plugins/pstack/rules/pstack-models.md`. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pstack>/<path>` when that file exists locally. The plugin ships `skills/`, `agents/`, `rules/`, `docs/guide/`, and `README.md`. Read the local copy with `read_file` and never fetch it. Give the user the URL when they need a web link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | `~/.gemini/antigravity/brain/<conversation-id>/.system_generated/logs/transcript.jsonl` (compact) and `transcript_full.jsonl` (read specific lines when `truncated_fields` is present). Find subagents by grepping `invoke_subagent` in `transcript.jsonl` and reading `~/.gemini/antigravity/brain/<subagent-conversation-id>/.system_generated/logs/transcript.jsonl`. |

## Cursor-only features

Antigravity has no Cursor Automations, Bugbot, Cursor cloud agents, or Cursor-specific `cursor-team-kit` built-ins. When a step needs a Cursor-only service, put one line in your reply, `Skipped in Antigravity: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | Antigravity |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. When the user explicitly asks for a local scheduled task in Antigravity, recommend `/schedule` or use the `automation` skill instead. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command (`gh`) that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents | `environment: "cloud"` maps to `Workspace: "share"` (or `"branch"`) on `invoke_subagent`, as in Subagent fields. Skip a step that needs the Cursor cloud agent dashboard or its remote VM. |
| A built-in PR tool | Use the forge command that the step gives, such as `gh pr create` via `run_command`. That is not a skip, so write no line. |
| `cursor-team-kit` skills (`/deslop`, `control-ui`, `control-cli`) | When `cursor-team-kit` is not installed: run `unslop` and `no-comments` before commit instead of `/deslop`, delegate live browser or web UI verification (`control-ui`) to Antigravity's built-in `browser` subagent (`TypeName: "browser"`, `Model: "flash"`), and verify CLIs and TUIs (`control-cli`) via `run_command`. |
