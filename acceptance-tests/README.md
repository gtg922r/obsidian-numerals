# Installed acceptance helper (execution disabled)

This independent Node 24 package contains a passive fixture observer, a bounded Linux controller and offline evidence checks. It does **not** run Obsidian in CI yet. `execution.json` is closed; changing it and adding an execution workflow require a separately reviewed owner handoff with exact candidate artifacts. The original `host-tests/` extraction recorder/catalog remain unchanged and must never load alongside Numerals.

Run pure checks from this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

The observer build is fixture-only and uses the pinned esbuild compiler, externalizing Obsidian/host CodeMirror. No candidate source, mathjs oracle, production debug API, engine modification or scope access is used. Generated bundles/evidence are ignored. The PR workflow only executes these pure tests/builds, with read-only repository permissions.

## Inputs and evidence

`catalog.json` preserves 83 `NOT_RUN` acceptance rows, synthetic scenarios and 13 upgrade seeds. These are behavioral specifications, not 83 automated passing tests. Scenario sources include original byte hashes, CRLF/emoji cases, offscreen definitions, references, insertion cycles, and footnote occurrence checks. `inputs.json` retains the official 1.13.7 Linux host, published stable 1.10.2 and selected Dataview release 0.5.70 pins. Dataview's actual manifest remains 0.5.68. BRAT is excluded from prepublication execution.

The future controller requires a schema-1 selector with repository, integration commit/tree, successful integration-push run ID/attempt, artifact ID/ZIP hash, exact three file sizes/hashes, candidate manifest, harness commit, helper/catalog/inputs/plan hashes, observation mode and selected integration. It verifies GitHub run/artifact/tree responses and rejects PR artifacts, mutable latest selectors, extra files, symlinks and ZIP path traversal. It installs the selected bytes without rebuilding the candidate. Only a fresh GitHub-hosted Linux x64 runner passes the first guard; no profile, network, launch or CDP work occurs before both guards pass.

Author a reviewed `*.plan.json` using the catalog's case IDs and paths, up to eight cases and 40 actions each. Actions are fixed: open/split/popout/close, requested view mode, sample, select, scroll, native text/limited keys and Dataview projection read. Actual Source/Live Preview toggling, native paste/mouse/result clicks, note creation/deletion/rename, native command/settings/plugin toggles, actual Dataview late enablement, screenshots, sequential stable upgrades and same-target popout execution-context routing need later concrete driver work. They return unavailable or remain unexecuted; prepared inputs do not establish that coverage. Source versus Live Preview requires the actual CM field observation, not a requested mode label.

`run.mjs` is present for review and is deliberately refused by the checked-in gate. There is no host workflow or release action. Its current result validator reports bounded observations and keeps the wider acceptance row partial; it cannot mark an entire matrix row passed. Host/platform coverage stays `NOT_RUN` until an actual authorized run. Running the helper's unit tests is not installed-product evidence.

## Observer boundaries

- Existing G `getEditorSnapshot` / `subscribeEditorSnapshot` methods are capability checked. Subscriptions retire on plugin, Editor/TFile, sourceId or temporary availability changes. Snapshot IDs, generations, descriptors and settings revisions are evidence; notifications are **not evaluation counts**. File-backed embeds and older artifacts without these seams have limited evidence.
- Instance-only Editor/Vault/DataAdapter wrappers call the original once with identical receiver/arguments/callbacks, return the exact original value/promise, and preserve exceptions. They add no promise handlers. Restoration receipts detect replacement; no global prototype patch is made. Origin, direct caller classification, CM changes and complete buffers corroborate candidate insertion.
- The CM extension has only event observers and update observations: no decorations, dispatch, filter, extender, history edit, synthesized event or input permission. Trusted events must be linked to the same view/state/change. Programmatic calls and userEvent strings do not establish native input.
- Only marked synthetic paths are observed. Vault calls, ordinary autosave and helper actions remain distinct. Absence of wrapped calls does not prove absence of all background filesystem writes. Exact zero-math, pending-disposal and deterministic fault/race assertions remain partial/unavailable without a faithful boundary.
- One app/profile/vault, at most two windows and six editors. The `about:blank` popout needs an expected returned leaf/window/nonce proof; URL/title alone never permits input. Capacity is checked before creating leaves. Targeted opens reuse the resolved leaf; targeted splits are refused until a relative-pane driver exists. Helper timers, subscriptions, wrappers, bridges and component registrations are disposed. A mode-specific disposal receipt is mandatory; missing receipts and unconfirmed process exit invalidate claims and fail the run. Abort independently starts owned-process termination and interrupts pending operations. Profile preparation runs in an owned child with its temporary directories beneath scratch. Lost ownership, event/byte/deadline overflow and cleanup faults invalidate strict claims.
- Control modes do not load the observer plugin or install wrappers/CM listeners. Their controller action handles only open/read/interact with owned synthetic views. A Numerals-disabled control separates host normalization; the unchanged-candidate control checks observable equivalence. Random samples are compared by type/range/relationships, not equal seeds.

Evidence exports are limited to four named JSON files: results (actions, bounded observations and deduplicated synthetic disk-byte blobs), provenance, the exact selection and their hash inventory. Original/saved disk BOM/CRLF bytes remain distinct from editor strings; the only settings file captured is the fixture Numerals `data.json`. No vault/profile dump, credentials, browser storage, raw stacks/environment/process logs, arbitrary settings or private planning packet is uploaded. Failed actions retain prior records; gaps cannot become passes. Immediate disk samples do not prove autosave has settled or exclude transient writes; screenshots and native UI coverage require their own reviewed driver steps.

Only the owner merges or publishes. Recovery PRs target `chore/recovery-1.11`; stable 1.10.2, existing release assets and stable manifest/version mappings remain untouched.

## First execution increment (not authorized by this scaffold)

Before any host run, review the execution workflow and the current-value sample/settle driver together. The owner must select one exact successful G/H integration-push artifact and its run/attempt, commit/tree, archive and three-file hashes; use the reviewed helper head and build/input/plan hashes. Never select an intermediate artifact by latest status.

Start with only the synthetic ORD-01 source in one main window, one leaf and Reading mode, with Dataview off. Install the exact candidate in a fresh marked Linux vault/profile. Verify host/plugin identities, open the note, wait within a bounded deadline for the intended owned DOM and current source state, capture original bytes, current buffer and exact selected occurrence, and obtain confirmed observer/process cleanup. Run unchanged-candidate and Numerals-disabled controls in separate fresh profiles. The present `ordering.plan.json` is only a historical observation smoke plan; do not interpret it as final-current acceptance or mark ORD-01 passed.

Prioritized driver work:
1. Bind final-current assertions to the intended action/sample, current Editor/TFile/sourceId/generation/full buffer and selected occurrence. Later pending/error/source changes must invalidate earlier ready values. Implement bounded DOM/state and MathJax settling and retain timeout evidence. This is mandatory before interpreting installed behavior.
2. Verify native Source/Live Preview transitions, trusted typing/paste, Undo/Redo, mouse/result clicks and native Update stored results invocation. Keep write checks within one explicit action interval.
3. Add note create/delete/rename and split-relative-to-target operations, real popout routing including a second execution context in one CDP target, and confirmed pane/window close behavior.
4. Add native settings Save/Cancel, plugin enable/disable/reload, sequential stable-to-candidate upgrade, and real Dataview late enablement/metadata events. Stage/download presence cannot establish activation.

`observed-dom-text` and `observed-numeric-result` return `OBSERVED`/`NOT_OBSERVED` with `historical-existence-only` scope. They describe whether a value occurred anywhere within the case/path; they never return `PASS`, establish final state, or select the intended same-path pane. Legacy `dom-text`/`numeric-result` final-behavior assertions are `UNAVAILABLE`. `one-write` requires an explicit `actionId`, one wrapper session and transaction ID, the same editor/window and ordered start → CM change → end with complete before/after buffers. These limited checks do not establish pending-race disposal, exact evaluation counts or universal absence of writes. All 83 catalog rows and unexecuted platforms remain `NOT_RUN`.
