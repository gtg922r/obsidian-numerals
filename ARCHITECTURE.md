# Numerals architecture

Numerals is an offline Obsidian plugin. Recovery work targets `chore/recovery-1.11`; stable distribution remains 1.10.2. Only the owner merges or publishes BRAT prereleases.

| Layer | Responsibility | Main files |
| --- | --- | --- |
| Plugin lifecycle | Register surfaces, commands and disposable host/settings events | `src/main.ts`, `src/host/events.ts` |
| Source ownership | Prove a complete MarkdownView editor buffer or capture a read-only target file | `src/host/sourceRegistry.ts` |
| Input coordination | Invalidate stale work, capture metadata/references, publish one ordered snapshot per input generation | `src/host/snapshotCoordinator.ts`, `src/host/captureInputs.ts` |
| Source index | Index the complete Markdown source with physical UTF-16 spans and extraction mappings | `src/evaluation/sourceIndex.ts`, `sourceProjection.ts` |
| Evaluation | Capture metadata, evaluate mathjs in source order, retain dependencies and detached results | `src/evaluation/evaluateNote.ts`, `noteService.ts`, `noteSnapshot.ts`, `metadataReferences.ts` |
| Runtime and settings | Own a private full mathjs engine, currency registry, preprocessing and formatter; atomically replace currency configurations | `src/mathRuntime.ts`, `src/settings/`, `src/formatting/` |
| Presentation | Project indexed occurrences, prepare display strings with the retained runtime, render Plain/TeX/SyntaxHighlight output | `src/host/presentation.ts`, `blockSurface.ts`, `occurrenceBinding.ts`, `src/inline/`, `src/renderers/` |
| Editor writes | Prove independent native input, prepare exact directive-span replacements, apply one guarded Editor.transaction | `src/host/trustedInput.ts`, `snapshotInsertion.ts`, `snapshotCoordinator.ts` |
| Suggestions | Read indexed source and current symbol descriptions from the exact supplied editor | `src/NumeralsSuggestor.ts` |

The index and evaluator never depend on visible CodeMirror ranges. Selection, scrolling, mode changes and formatting only change presentation. Renderers receive prepared strings and descriptions; trusted presentation preparation uses the exact snapshot's retained engine. Existing mathjs breadth and the shared formatter remain intact.

Live Preview's pure StateField supplies full-note prepared decorations before viewport layout, including multiline inline replacements. Its ViewPlugin owns source/input subscriptions and guarded publication; source-session identity survives temporary text invalidation and changes when an Editor loads a replacement file.

Source, metadata, dependencies, evaluation settings and runtime generations determine mathematical validity. Host events invalidate these inputs; they do not prove cached metadata freshness. Read-only captures and detached callbacks cannot acquire editor capabilities by matching a path.

See [surface and insertion contracts](docs/recovery/snapshot-surfaces.md), [source indexing](docs/recovery/source-index.md), [ordered snapshots](docs/recovery/note-snapshots.md), [metadata](docs/recovery/note-metadata.md), [settings/runtime ownership](docs/recovery/settings-currency.md), and the [recovery plan](docs/recovery/plan.md). The earlier Package C lifecycle document describes the phase before snapshot integration. Installed-artifact acceptance belongs to Package I; Node tests alone do not establish Obsidian platform coverage.
