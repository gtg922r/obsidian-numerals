# Recovery implementation contract

## Authority and release boundary

The user authorized implementation on 2026-09-13, including dedicated Codex tasks, independent sub-agent reviews, owner-approved PR merges, and BRAT prerelease publication. **No production releases or promotions are authorized.**

- Integration branch: `chore/recovery-1.11`. Feature PRs target this branch. Never merge recovery metadata to `master`.
- Stable remains 1.10.2. Preserve master's manifest, versions mappings, existing tags and assets.
- New GitHub releases must explicitly be prereleases and must not become latest/stable.
- Start with 1.11.0; subsequent candidate changes use the next unused production-shaped version. Never move tags or replace published assets.
- Only the owner task publishes or merges. Implementation tasks produce focused PRs and wait for feedback.

## Settled product choices

- Currency symbols default for new installations and upgrades without a saved preference. Preserve valid saved code/symbol choices. Currency-standard precision remains the default; compound rates retain existing policy. Inserted currencies keep codes.
- Minimum Obsidian 1.13.0, one declarative settings UI. No legacy display fallback.
- Whole-note top-to-bottom evaluation. No implicit forward references.
- Reliability and already-merged features first. New custom units are separate work.
- Retain mathjs feature breadth, shared ResultFormatter, renderer strategies, and metadata opt-in.
- Keep a short Markdown architecture map; archive the interactive atlas and old prototypes outside source.

## Currency runtime ownership

Use a private `create(all)` mathjs instance behind a small import gateway, retaining the full function set and existing evaluators. Prepare a fresh runtime, currency registry, preprocessing rules and formatter when currency mappings change. Validate and persist the candidate before activating it; failed Save and Cancel preserve the active state. Serialize saves. Formatting-only changes replace presentation configuration without recreating the engine.

Native quoted unit strings, suffix symbols, spaced symbols, compound rates and conversion targets remain supported alongside scanner-recognized prefix amounts. Keep strings protected; native mathjs aliases handle quoted unit strings. Apply alpha hooks only to the owned instance, avoid shared global registry mutation, unit deletion and collision overrides, and use literal validated Unicode currency output instead of global MathJax macros.

Runtime replacement invalidates old scopes, compiled functions, results and insertion proposals. Snapshots retain their originating runtime/formatting context until retired; never interpret an older Unit using a different runtime registry. Removing a configured custom currency removes its unconfigured code/aliases on rebuild, matching restart behavior. Ad-hoc source `createUnit` declarations must replay and still report collisions visibly; this does not resolve #175.

Reject canonical currency codes that collide with physical units, mathjs constants, functions or operators. Optional lowercase aliases may be omitted with explicit guidance when occupied: `CUP` can identify currency while `cup` remains a volume. Currency aliases inside collection results must serialize to codes without changing value precision, valueless status or unrelated unit formatting. If saved currency settings are semantically invalid on load, preserve them and keep settings accessible; present a configuration diagnostic and block evaluation until a valid Save or explicit Remove repairs the configuration. Do not silently activate a substitute mapping.

## Source and evaluation contracts

The shared expression scanner protects strings/comments and recognizes delimiter context, currency tokens and references. Function/array/index commas remain delimiters (`max(1,234)` is two args; `[1,234]` is two elements). Complete grouped numbers may normalize in unambiguous expression positions. Explicit `$1,234.50` is one currency token even in a call/list. Never partially strip malformed grouping (`1,0001`). Mathjs is still the expression parser.

Cross-note references bind raw supported mathjs values under internal symbols rather than injecting formatted source text. Preserve source mapping and original user input in displays/diagnostics. Clone mutable mathjs values with public APIs and forbid assignments to reference bindings. Track unresolved references so repairing a note/property refreshes error output. Preserve frontmatter/Dataview opt-in and array field interpretation. Cross-note computed globals/functions are out of this milestone.

Whole-note boundaries: `indexNote` produces ordered calculations, original spans and extraction mappings; `evaluateNote` produces raw results, diagnostics, current globals and dependencies; host adapters render or apply verified proposals. Validate and pin a standalone Markdown parser (preferred candidate `@lezer/markdown`) against Obsidian extraction fixtures. Never depend on visible CM6 syntax ranges for evaluation order.

- Frontmatter and Dataview initialize scope.
- Ordinary assignments remain block-local; ordinary inline assignments remain local to that expression.
- Successful dollar-prefixed assignments export to subsequent calculations; latest preceding assignment wins. Functions/values never survive into a newer source revision.
- An exported function retains its defining block's ordinary locals while dollar-prefixed free variables read the latest successful assignment in the current note generation. For example, `$rate = 2; local = 10; $f(x) = local + x * $rate` yields 14 for a subsequent `$f(2)`, then 16 after a later `$rate = 3`. An ordinary `local` in another block does not replace the captured value.
- Commit new/replaced scope bindings after each successful source row or inline expression. Discard staged bindings from a failing row/expression, preserving earlier successful rows. Detach each result when recorded so later collection mutations cannot change earlier displayed results. Preserve native object identity inside the current generation: deep-copying every frame would break ordinary closures that capture mutable arguments.
- Binding rollback is not a general transaction over arbitrary mathjs execution. Mutation inside an opaque captured object or nested closure, and engine-level side effects such as `createUnit`, cannot be rolled back through public scope APIs. Record this limitation and test it honestly; do not introduce a second interpreter, proxy every mathjs value, or replay nondeterministic calculations to imply full rollback. No values or closures cross source generations.
- Errors stop the remainder of that block while preserving earlier successful results. Inline errors clear the inline previous-result chain.
- Inline `@prev` follows the prior inline expression across the full note. Blocks have their own existing `@prev` and `@sum` semantics, including existing comment/blank boundaries. Formatting directives stay evaluation-transparent.
- Selection only changes source/widget visibility. Selection/scroll changes do not evaluate math.
- Formatting changes reformat raw values; they do not change calculation scope.
- Recompute affected notes on meaningful source/metadata/dependency/evaluation-settings changes. Cache by full input generation and discard stale asynchronous work.

## Host lifecycle and source safety

One disposable controller/subscription set per rendered occurrence; identical calculations are legitimate distinct occurrences. Remove parent/text deduplication. Normalize native Obsidian `(file,data,cache)` and Dataview `(type,file)` events separately. Subscribe even when opening in Source mode. Handle edit, settings changes, file creation/deletion/rename, and unload. Renderer exceptions produce visible diagnostics.

Insertion proposals contain editor identity, file, source revision and metadata/settings generation, exact expected span and replacement. Apply a single Editor.transaction only when all identities/generations and expected text still match. Replace directive spans, never whole captured lines. Discard stale proposals. No background vault writes. Preserve current canonical formatting; serialization migration is separate.

Automatic insertion allows one complete-note batch per independently initiated editor input cycle. Reserve the allowance before the transaction; own writes, metadata/Dataview/dependency echoes, synchronized buffer echoes, selection, scrolling and controller recreation do not renew it. A proven independent user input or the explicit **Update stored results** command can begin another cycle. Undo/Redo never renew automatic writes, so undoing an insertion does not immediately reapply it. Ambiguous input causes still refresh mathematics but require the explicit action for a new write.

The resulting full source is evaluated afresh. Stored output is the checked pre-write sample, so nondeterministic live output can differ; metadata-only changes may update live results while stored fields await another independent edit/action. Explain a differing stored value locally without repeated global notices. Do not reuse an older source generation or suppress native replay errors to conceal this distinction.

## Work packages

| Package | Ownership | Outcome |
| --- | --- | --- |
| A | Owner + audit agent | Verified backup/restore, ownership-aware cleanup, isolated baseline |
| B | Dedicated task | CI/typecheck/build isolation, Node24 Actions, prerelease-only tooling |
| C | Targeted agent PRs | Render controllers, correct events, Source subscriptions, popout safety |
| D | Dedicated task | Lexical normalization + typed references + wrong-answer regressions |
| E | Dedicated task | Complete declarative settings, normalization, currency lifecycle/defaults |
| F | Dedicated task; new modules after D/settings contract, integration after E | Source index + ordered note snapshots |
| G | Dedicated task after C-F | Both surfaces use snapshots + transactional insertion |
| H | Targeted agents | Suggestions/errors, documentation, accurate backlog disposition |
| I | Dedicated validation + owner | Local installed-artifact QA, BRAT publication/verification, handoff; hosted installed suite deferred |

At most two implementation tasks run concurrently, with no overlapping file ownership. Owner assigns exact bases and target branches. Do not make alternative parallel implementations. Existing APIs may need phased adaptation, but no temporary compatibility path may silently violate the contracts above.

## Review and checks

Every PR receives independent sub-agent review; significant evaluation/lifecycle/write changes receive a second architectural review. Authors address findings; re-review actual revised head and any rebase/conflict resolutions. Owner merges after tests/checks and material findings are resolved. Conventional commits, focused PRs, changelog under Unreleased, and documentation for user-facing semantics.

CI: npm ci, lint, production and test typechecks, Jest, production build, symbols check. Separate TS configs without dropping test typechecks; exclude nested worktrees. Do not weaken checks to claim green. Tests must prove user behavior rather than merely restate current implementation.

Acceptance fixtures: reference freshness/negative/complex values, deleted globals, missing references repaired; function/matrix/currency grouping and comments/strings; offscreen definitions/selected predecessors/identical blocks; Reading/LP/Source transitions, embeds/callouts/split panes/popouts; rapid edits/stale generations/unload/mismatched buffers; settings upgrades/currency mapping; multi-backtick/tilde/longer fences, nested quote/list prefixes, inline newlines, CRLF/frontmatter/HTML and Obsidian comments.

### Current validation path (2026-09-13)

The user selected local computer testing plus the existing reviewed automated checks as the recovery path. The owner selects focused installed checks against the verified candidate in a disposable fixture vault, covering the changed behavior and source-safety risks above. Record the tested commit, artifact hashes, host version/platform, observations, failures and unavailable coverage. Minimum/current desktop, mobile and early-access coverage must be described accurately; unavailable platforms are disclosed gaps, not implied passes. Node unit tests do not establish live host behavior.

GitHub-hosted installed Obsidian testing is **DEFERRED: optional roadmap work**, not required for recovery. The earlier request for permission to add its execution workflow is superseded; no workflow approval is awaited. Retain the disabled helper and its 83 `NOT_RUN` catalog rows as reusable test design. Completing those rows or enabling the helper is not a recovery gate, and their status must not be changed to imply local evidence that was not collected. Existing extraction evidence and pure CI checks remain valid within their documented limits.

Disposable vaults only for automated host QA; do not modify personal notes or replace the live installed plugin without owner coordination. Local testing does not require the deferred hosted workflow or helper. Exact artifact verification and owner-only BRAT publication remain required.

### Optional validation roadmap

Revisit a GitHub-hosted installed suite if repeatable multi-version or platform coverage justifies it. Build on the retained helper, synthetic catalog and reviewed artifact-selection design; separately scope the native drivers, workflow and evidence gaps before enabling execution. This future capability does not delay local recovery validation or BRAT readiness.

## Known evidence and explicit non-fixes

Upstream baseline 3f1ea98 passes 536 tests, build, lint and symbols checks. Prior probes demonstrate native reference changes remaining stale, squaring a -2 reference yielding -4, and deleted globals retained. Parent-based block dedup is a demonstrated defect/strong #173 candidate, not a traced explanation of every reported rendering failure.

Do not catch-and-ignore createUnit collisions or inject override:true. Keep #175 open with actionable guidance; remove the vestigial hidden @createUnit stub. New safe custom-unit declarations require a later design. Do not revive rejected #138 parsing rewrites.

Preserve intentional longest-prefix trigger matching; reject exact duplicate nonempty triggers. Empty triggers disable that mode.

Do not close #82 as fulfilled by @hideRows: it asks to retain variable/result while hiding expression. Verify delivered/duplicate issues individually and identify BRAT-only fixes as such.

## Completion

Existing automated checks and focused local installed validation, verified BRAT prerelease assets, tested commit/hashes, reviewed PR history, recorded platform coverage/limitations, and stable distribution unchanged. The optional hosted installed suite and its unexecuted catalog are not completion criteria. Stop before production promotion. Later custom units, locale input, export/alignment and other features remain separately specified work; any publication remains prerelease-only.
