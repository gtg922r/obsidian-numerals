import { parseYaml, type App, TFile } from 'obsidian';
import { sourceLineAt, sourceLineStarts, type NoteSourceIndex } from '../evaluation/sourceIndex';
import type { CapturedNoteReference } from '../evaluation/evaluateNote';
import { captureDeclarativeMetadataValue, type DataviewMetadataInput } from '../evaluation/metadata';
import { resolveCapturedMetadataReferences } from '../evaluation/metadataReferences';
import { parseCrossNoteReferences, type CrossNoteReference } from '../processing/crossNoteResolver';
import { getDataviewApi, type DataviewApi } from '../dataview';
import type { SnapshotConfiguration } from './snapshotCoordinator';
import type { MathJsInstance } from 'mathjs';
import { preProcessBlockForNumeralsDirectives } from '../processing/preprocessor';

let captureRevision = 0;
class UncapturableMetadata { readonly kind = 'uncapturable-provider-value'; }

function ownValue(value: unknown, key: string): unknown {
 if (!value || typeof value !== 'object') return undefined;
 const descriptor = Object.getOwnPropertyDescriptor(value, key);
 return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/** Detach provider data before awaiting file I/O; retain the YAML-key provenance. */
function dataviewInput(api: DataviewApi | undefined, path: string, revision: string, engine: MathJsInstance): DataviewMetadataInput {
 if (!api) return {status: 'absent'};
 const page = api.page(path);
 if (!page) return {status: 'pending', startedAtMs: performance.now()};
 const metadata: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
 for (const key of Object.keys(page)) {
  if (key === 'file') continue;
  const descriptor = Object.getOwnPropertyDescriptor(page, key);
  try {
   if (!descriptor || !('value' in descriptor)) throw new Error('Provider accessor');
   metadata[key] = captureDeclarativeMetadataValue(descriptor.value, engine);
  } catch { metadata[key] = new UncapturableMetadata(); }
 }
 // Other file properties (links/tasks/provider classes) are not calculation
 // fields. Keep the exact detached frontmatter shape; missing/invalid is never {}.
 const frontmatter = ownValue(ownValue(page, 'file'), 'frontmatter');
 try { metadata.file = {frontmatter: captureDeclarativeMetadataValue(frontmatter, engine)}; }
 catch { metadata.file = {frontmatter: new UncapturableMetadata()}; }
 return {status: 'projection', origin: 'page', revision, metadata};
}

interface ReferenceOccurrence {
 readonly calculationId: string;
 readonly reference: CrossNoteReference;
 readonly file: TFile | null;
 readonly path?: string;
}
interface TargetCapture {
 readonly file: TFile;
 readonly path: string;
 readonly dataview: DataviewMetadataInput;
 readonly occurrences: ReferenceOccurrence[];
 text?: string;
 error?: string;
}

/** Host I/O only. F's shared collector owns all metadata/reference mathematics. */
export async function captureHostInputs(app: App, index: NoteSourceIndex, configuration: SnapshotConfiguration,
 signal: AbortSignal, isCurrent: () => boolean) {
 const assertCurrent = () => { if (signal.aborted || !isCurrent()) throw new Error('Source capture was superseded.'); };
 assertCurrent();
 const revision = String(++captureRevision), sourcePath = index.source.path ?? '';
 const api = getDataviewApi(app), engine = configuration.runtime.engine;
 const dataview = dataviewInput(api, sourcePath, revision, engine);
 const occurrences: ReferenceOccurrence[] = [], targets = new Map<TFile, TargetCapture>();
 if (configuration.settings.enableCrossNoteReferences) {
  for (const calculation of index.calculations) {
   const text = calculation.kind === 'block' ? calculation.projection.text : calculation.expression.text;
   const starts = sourceLineStarts(text);
   const transparent = calculation.kind === 'block'
    ? new Set(preProcessBlockForNumeralsDirectives(text, []).transparentLineIndexes) : new Set<number>();
   for (const reference of parseCrossNoteReferences(text)) {
    const row = sourceLineAt(starts, reference.start);
    // F strips recognized formatting rows, including invalid directives. They
    // must not trigger target I/O or metadata mathematics during host capture.
    // Retained references keep their original complete-projection offsets.
    if (transparent.has(row)) continue;
    const destination = app.metadataCache.getFirstLinkpathDest(reference.noteName, sourcePath);
    const file = destination instanceof TFile ? destination : null;
    const occurrence: ReferenceOccurrence = {calculationId: calculation.id, reference, file, path: file?.path};
    occurrences.push(occurrence);
    if (!file) continue;
    let target = targets.get(file);
    if (!target) {
     target = {file, path: file.path, occurrences: [], dataview: dataviewInput(api, file.path, revision, engine)};
     targets.set(file, target);
    }
    target.occurrences.push(occurrence);
   }
  }
 }
 await Promise.all([...targets.values()].map(async target => {
  try { target.text = await app.vault.read(target.file); }
  catch (error: unknown) { target.error = error instanceof Error ? error.message : String(error); }
 }));
 const validateTargets = () => {
  assertCurrent();
  for (const target of targets.values()) {
   if (target.file.path !== target.path || app.vault.getAbstractFileByPath(target.path) !== target.file ||
    target.occurrences.some(occurrence => app.metadataCache.getFirstLinkpathDest(occurrence.reference.noteName, sourcePath) !== target.file)) {
    throw new Error('Referenced note changed while its source was being captured.');
   }
  }
 };
 validateTargets();
 const results = new Map<ReferenceOccurrence, Pick<CapturedNoteReference, 'result' | 'provenance'>>();
 for (const target of targets.values()) {
  validateTargets(); // before any shared collector can execute reference mathematics
  if (target.error || target.text === undefined) {
   for (const occurrence of target.occurrences) results.set(occurrence, {result: {status: 'invalid-value', referencedPath: target.path,
    error: `Unable to read referenced note: ${target.error ?? 'source unavailable'}`}});
   continue;
  }
  const captured = resolveCapturedMetadataReferences({
   source: {sourceId: JSON.stringify([index.source.sourceId, 'reference', target.path]), revision, path: target.path, text: target.text},
   engine, parseYaml, forceAll: configuration.settings.forceProcessAllFrontmatter, dataview: target.dataview,
   nowMs: performance.now(), metadataGeneration: revision, runtimeGeneration: configuration.runtime.currencyGeneration,
   preProcessors: configuration.runtime.preProcessors, propertyPaths: target.occurrences.map(item => item.reference.propertyPath),
  }, signal);
  for (const [ordinal, occurrence] of target.occurrences.entries()) {
   const value = captured[ordinal];
   if (!value || value.propertyPath !== occurrence.reference.propertyPath) throw new Error('Reference capture did not preserve request identity.');
   results.set(occurrence, {result: value.result, provenance: value.provenance});
  }
 }
 validateTargets();
 const references: CapturedNoteReference[] = occurrences.map(occurrence => ({
  calculationId: occurrence.calculationId, start: occurrence.reference.start, end: occurrence.reference.end,
  fullMatch: occurrence.reference.fullMatch, runtime: engine,
  ...(results.get(occurrence) ?? {result: {status: 'missing-note' as const, error: `Note "${occurrence.reference.noteName}" not found in vault`}}),
 }));
 return {parseYaml, dataview, references};
}
