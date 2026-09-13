# Snapshot surfaces and guarded insertion (Package G)

## Ownership and evaluation

`SourceRegistry` proves an editor through the actual MarkdownView, Editor and TFile identities, connected owning DOM, and complete editor/view text. A CodeMirror `MarkdownFileInfo` path or a table-cell document is insufficient. Temporary subview synchronization, CM recreation and mode/layout changes retain an existing attachment cycle. A closed view or real file switch retires it.

Every proved full editor buffer owns one `SnapshotCoordinator` session. A generation indexes and evaluates the whole note through F, including offscreen blocks and selected inline predecessors. Blocks, Reading inline occurrences and Live Preview widgets project that shared snapshot. Different editors with independently owned buffers remain different sources, even for one path. Public editor changes cancel obsolete queued math immediately, before deferred CM input classification; they do not adopt source text or grant insertion permission. A rapid change/revert recovers a fresh revision without a new allowance. Pending input invalidation removes stale output immediately; a superseded asynchronous capture cannot evaluate metadata or publish an error into its replacement generation.

Metadata and cross-note values come from exact captured source bytes. The host copies provider data before awaiting file reads, using F's declarative capture helper, then invokes one shared reference batch per target capture. Duplicate property requests retain their occurrence identities and share one metadata-initialization sample, with independent typed result copies. Recognized formatting-only rows do not trigger target reads or metadata evaluation. Their transparency comes from the existing scanner/preprocessor, so real references after multiline strings retain their original offsets. Referenced computed globals/functions remain outside recovery scope. Dataview page events/revisions and cached YAML are not exact-buffer freshness evidence; F owns opt-in, quarantine, per-result insertion provenance and its bounded status transition.

Unknown origins and embeds read the complete target file and retain that capture only while occurrences use it. Same-file embeds are also read-only. A detached native callback may reuse an already attached editor's mathematics only when its connected context belongs to that exact MarkdownView, sourcePath agrees, and complete section text matches the authoritative buffer. This optional context evidence was observed in pinned host fixtures; it is not an editor capability. Detached callbacks receive no editor/navigation capability, do not attach or rearm editors, and preserve the original source identity when checking newline/BOM-normalized host text.

## Occurrence binding and rendering

A block binds its exact extracted payload to one calculation inside a validated physical section. Reading inline sections retain membership across repeated/subtree callbacks and inspect their complete code-node sequence, including nodes not yet processed and ordinary non-trigger code. Indexed source order supplies occurrence ordinals only after sequence and count agree. Repeated expressions remain separate occurrences; incomplete or duplicate evidence never selects the first matching expression.

Raw HTML code contributes non-calculation placeholders only from F's excluded HTML spans. Overlapping spans are canonicalized before sanitizing those placeholders. Raw/foreign code keeps its original DOM, including when its text equals a Markdown calculation. Changed external code content is new source evidence; transformed Numerals output is never parsed as new source. Unmapped occurrences retain their code with a local identity limitation. Removing or transferring a child releases its old subscription without affecting the replacement.

Native Reading footnotes relocate their body outside the physical source section. G groups only calculations already indexed by F, using parsed definition containers and conservative balanced inline-footnote spans within F prose/exclusions. Complete unique code sequences may bind without inventing evaluation occurrences. Optional signed LI `data-line` and native body identity further constrain a group to its original starting line; malformed, out-of-range or inconsistent attributes withhold mapping. A direct body under `section.footnotes > ol` is required, and physical excluded HTML cannot borrow an indexed real footnote through imitated attributes. Multiple indistinguishable inline notes on one line stay unmapped. Adjacent definitions that F represents as one container also stay unmapped when their separate rendered bodies lack a complete match. This is an explicit limitation, not a suggestion to reopen the note.

The adjacent-definition regression uses this exact source:

~~~markdown
text[^b] and text[^a]

[^a]: `#: $x = 1`
[^b]: `#: $x = 1`
~~~

F supplies two indexed calculations whose definition containers both span UTF-16 offsets `[23, 58)`, with marker `[23, 29)`. G preserves source-order mathematics but withholds separately rendered bodies without complete occurrence proof. Adding a blank line between those definitions produces distinct containers and is a verified unit-test workaround. Installed coverage and a focused parser follow-up remain separate.

The signed-line relationship is derived from static inspection of the retained official Obsidian 1.13.7 bundle (`app.js` SHA-256 `8efbf581e259cabef4f9c9a34814cfe3c02863757377e56b3603933c50e89898`). Accepted native fixtures 059/060 establish relocated section coordinates, but did not record those optional attributes. Installed checks for attribute timing, ordering, repeated expressions and same-line inline notes remain required; no additional host run is claimed here.

`SurfaceSubscription` owns source retention, subscriptions and an abort signal. A publication during rendering schedules a coalesced follow-up instead of dropping the invalidation. Replacing/discarding a snapshot aborts old MathJax output. Synchronous and asynchronous MathJax failures are visible; settings remain available if MathJax fails to load.

Trusted presentation preparation uses the exact snapshot's retained engine for input TeX/syntax conversion and the shared snapshot formatter for results. Plain, TeX and SyntaxHighlight renderers receive prepared data and never evaluate calculations. Inline emphasis/highlight classes come from the current CM syntax tree solely for presentation. Formatting, selection, viewport and Source/Reading/Live Preview transitions do not evaluate math. Mapped block navigation checks the current owner/generation and uses the physical row projection; it does not infer source columns from transformed display text.

## One automatic batch per input cycle

An actual new full-editor/file attachment grants one initial automatic batch allowance. Thereafter only a proved independent native editor input may renew it. A trusted input or paste event must correlate with the same EditorView/start state and its immediate, exact, nonremote CM document transaction. Paste normalization uses CM's own document rules. An unused witness expires at the microtask boundary; a declined native input cannot authorize a later labeled programmatic edit. Transaction annotations alone are insufficient. Undo, redo, composing/ambiguous input, completion and delayed edits refresh mathematics but do not renew automatic writes.

All eligible whole-note insertion directives, including offscreen occurrences, are prepared together. Before a single `Editor.transaction`, G checks the exact live snapshot identity, Editor/TFile/path/full source, evaluation/settings/runtime generations, runtime safety epochs, complete expected wrapper bytes, and nonoverlapping physical spans. It replaces only the directive spans, preserving surrounding comments, container prefixes, CRLF, nested stored matrices/strings and code-based currency serialization. No background vault writes, whole-line replacement or insertion timers exist.

The coordinator consumes the allowance and records its own-write receipt before dispatch. Successful dispatch is followed by a fresh full-note evaluation. It does not acknowledge old results into a new generation or reuse populated scopes. Own writes, synchronous pane echoes, native/Dataview metadata and dependency feedback, presentation changes, remounts and mode changes never renew the allowance. Echo suppression remains after an originating pane closes, so delayed feedback cannot become a new attachment allowance.

The stable command **Update stored results** (`update-stored-results`) checks the exact supplied editor without side effects. Execution attempts one current guarded batch and grants no future automatic permission. A failed/stale proposal requires a fresh command or independently proved input. For nondeterministic expressions, the persisted pre-write sample can differ from the fresh post-write result. When that happens, the occurrence says: “Stored result differs from the current result. Use Update stored results to write it once.” Metadata may continue to refresh displayed results while stored source waits for new input or this command.

## Validation boundary

Regressions use real F snapshots, actual public CM EditorViews/input ordering, and controlled host DOM/lifecycle fixtures. They cover offscreen/selected predecessors, repeated/subtree callbacks, raw HTML, mapped containers/CRLF, source ownership and detached origins, reentrant/stale invalidation, mode/settings changes, guarded writes and MathJax cancellation. The native event trust bit is supplied at the test browser boundary; these tests do not claim installed Obsidian input acceptance. Package I owns isolated installed-artifact validation. No personal vault, local installed plugin or stable release metadata is changed by G.
