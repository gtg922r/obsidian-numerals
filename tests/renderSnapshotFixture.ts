import type { MathJsInstance } from 'mathjs';
import { getMathRuntime } from '../src/mathRuntime';
import { captureNoteEvaluationInput, evaluateNote, type CapturedNoteReference } from '../src/evaluation/evaluateNote';
import { indexNote } from '../src/evaluation/sourceIndex';
import { parseCrossNoteReferences } from '../src/processing/crossNoteResolver';
import { prepareBlockPresentation } from '../src/host/presentation';
import { renderNumeralsBlock, renderDiagnostic, applyBlockStyles } from '../src/rendering/orchestrator';
import { type NumeralsSettings, type StringReplaceMap, NumeralsRenderStyle } from '../src/numerals.types';
import { createResultFormatter, createNumberFormatProfile, type ResultFormatter } from '../src/formatting';
import { createDefaultSettings } from '../src/settings/normalization';
const yaml = jest.requireActual<{load(source: string): unknown; dump(value: unknown): string}>('js-yaml');

/** Rendering fixture uses F's real complete-note evaluator, with explicit captured reference inputs. */
export function renderSnapshotFixture(element: HTMLElement, source: string, options: {
 settings?: NumeralsSettings; metadata?: Record<string, unknown>; style?: NumeralsRenderStyle;
 engine?: MathJsInstance; formatter?: ResultFormatter; processors?: StringReplaceMap[]; references?: ReadonlyMap<string, unknown>;
} = {}) {
 const settings = options.settings ?? createDefaultSettings(), engine = options.engine ?? getMathRuntime();
 const formatter = options.formatter ?? createResultFormatter({runtime: engine, profile: createNumberFormatProfile(settings.numberFormat, 'en-US', engine)});
 const text = (options.metadata ? '---\n' + yaml.dump(options.metadata) + '---\n' : '') + '````math\n' + source + '\n````';
 const index = indexNote({sourceId: 'render-fixture', path: 'source.md', revision: 0, text});
 const references: CapturedNoteReference[] = index.calculations.flatMap(calculation => parseCrossNoteReferences(calculation.projection.text).map(reference => ({
  calculationId: calculation.id, ...reference, runtime: engine,
  result: {status: 'resolved' as const, value: options.references?.get(reference.fullMatch), referencedPath: reference.noteName + '.md'},
  provenance: {unverified: [], ambiguous: false},
 })));
 const snapshot = evaluateNote(captureNoteEvaluationInput({generation: {sourceId: 'render-fixture', sourcePath: 'source.md', sourceRevision: 0,
  sourceText: text, metadataRevision: '0', dependencyRevision: '0', evaluationSettingsRevision: '0', runtimeGeneration: 0},
  runtime: {engine, formatter}, parseYaml: yaml.load, preProcessors: options.processors ?? [], references,
  forceAllMetadata: settings.forceProcessAllFrontmatter}));
 const calculation = snapshot.calculations[0], renderStyle = options.style ?? settings.defaultRenderStyle;
 applyBlockStyles({el: element, settings, blockRenderStyle: renderStyle, hasEmitters: Boolean(calculation?.block?.blockInfo.emitter_lines.length)});
 if (calculation) {
  const prepared = prepareBlockPresentation(snapshot, calculation, settings, renderStyle, engine);
  renderNumeralsBlock(element, prepared.lines, {settings, renderStyle, signal: new AbortController().signal});
  if (calculation.diagnostic) renderDiagnostic(element, calculation.diagnostic.message, calculation.diagnostic.input);
  for (const diagnostic of prepared.diagnostics) renderDiagnostic(element, diagnostic.message, diagnostic.input);
 }
 for (const diagnostic of snapshot.diagnostics.filter(item => item.kind === 'metadata' || item.kind === 'configuration')) {
  element.createDiv({cls: 'numerals-warning', text: diagnostic.message});
 }
 return snapshot;
}
