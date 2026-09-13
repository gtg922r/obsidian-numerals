import { TFile, parseYaml } from 'obsidian';
import { createTestHost } from './hostTestSupport';
import { snapshotFixture } from './hostSnapshotTestSupport';
import { captureHostInputs } from '../src/host/captureInputs';
import { indexNote } from '../src/evaluation/sourceIndex';
import { captureNoteMetadata } from '../src/evaluation/metadata';
import * as references from '../src/evaluation/metadataReferences';
import { captureNoteEvaluationInput, evaluateNote } from '../src/evaluation/evaluateNote';

jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));
afterEach(() => jest.restoreAllMocks());

function fixture(text = '`#: [[Target]].price ^ 2`') {
 const runtime = snapshotFixture(text); runtime.coordinator.dispose();
 const host = createTestHost(), target = Object.assign(new TFile(), {path: 'Target.md'});
 host.files.set(target.path, target);
 const buffers = new Map([[target.path, '---\nnumerals: all\nprice: -2\n---']]);
 const read = jest.fn(async (file: TFile) => buffers.get(file.path) ?? ''); Object.assign(host.app.vault, {read});
 const index = indexNote({sourceId: 'source-editor', path: 'source.md', revision: 1, text});
 const configuration = runtime.configuration(); configuration.settings.enableCrossNoteReferences = true;
 const abort = new AbortController(); let current = true;
 const capture = () => captureHostInputs(host.app, index, configuration, abort.signal, () => current);
 const evaluate = (input: Awaited<ReturnType<typeof capture>>) => evaluateNote(captureNoteEvaluationInput({
  generation: {sourceId: index.source.sourceId, sourcePath: index.source.path, sourceRevision: index.source.revision, sourceText: text,
   metadataRevision: '1', dependencyRevision: '1', evaluationSettingsRevision: '0', runtimeGeneration: configuration.runtime.currencyGeneration},
  runtime: configuration.runtime, preProcessors: configuration.runtime.preProcessors, ...input,
 }));
 return {...host, ...runtime, index, configuration, target, buffers, read, abort, capture, evaluate, supersede() {current = false;}};
}

it('uses exact captured target source instead of cached YAML and preserves negative typed values', async () => {
 const host = fixture(); host.frontmatter.set('Target.md', {numerals: 'all', price: 99});
 const input = await host.capture(), snapshot = host.evaluate(input);
 expect(input.references[0].result).toMatchObject({status: 'resolved', value: -2});
 expect(snapshot.format(snapshot.calculations[0].calculationId, 0)).toMatchObject({value: {canonical: '4'}});
 expect(host.read).toHaveBeenCalledTimes(1);
});

it('groups repeated target occurrences into one capture and one metadata initialization sample', async () => {
 const host = fixture('`#: [[Target]].roll` `#: [[Target]].roll` `#: [[Target]].nested.x`');
 host.buffers.set('Target.md', '---\nnumerals: all\nroll: random()\nnested:\n  x: 5\n---');
 const batch = jest.spyOn(references, 'resolveCapturedMetadataReferences');
 const input = await host.capture();
 expect(batch).toHaveBeenCalledTimes(1); expect(host.read).toHaveBeenCalledTimes(1);
 expect(batch.mock.calls[0][0].propertyPaths).toEqual(['roll', 'roll', 'nested.x']);
 expect(input.references[0].result).toEqual(input.references[1].result);
 expect(input.references[2].result).toMatchObject({status: 'resolved', value: 5});
 expect(input.references.map(item => item.calculationId)).toEqual(host.index.calculations.map(item => item.id));
});

it.each(['abort', 'superseded', 'rename', 'replacement', 'link-resolution'])('rejects stale target I/O before metadata math: %s', async cause => {
 const host = fixture(); let resolve!: (text: string) => void;
 host.read.mockImplementationOnce(() => new Promise<string>(done => {resolve = done;}));
 const batch = jest.spyOn(references, 'resolveCapturedMetadataReferences'), pending = host.capture();
 if (cause === 'abort') host.abort.abort();
 if (cause === 'superseded') host.supersede();
 if (cause === 'rename') host.target.path = 'Moved.md';
 if (cause === 'replacement') host.files.set('Target.md', Object.assign(new TFile(), {path: 'Target.md'}));
 if (cause === 'link-resolution') jest.spyOn(host.app.metadataCache, 'getFirstLinkpathDest').mockReturnValue(null);
 resolve('---\nnumerals: all\nprice: random()\n---');
 await expect(pending).rejects.toThrow(); expect(batch).not.toHaveBeenCalled();
});

it('retains unresolved and unreadable occurrences for dependency repair', async () => {
 const host = fixture('`#: [[Missing]].price` `#: [[Target]].price`');
 host.read.mockRejectedValueOnce(new Error('Disk unavailable'));
 const input = await host.capture(); expect(input.references.map(item => item.result.status)).toEqual(['missing-note', 'invalid-value']);
 expect(input.references[1].result.error).toContain('Disk unavailable');
 const snapshot = host.evaluate(input); expect(snapshot.dependencies).toEqual(expect.arrayContaining([
  expect.objectContaining({noteName: 'Missing', status: 'missing-note'}), expect.objectContaining({noteName: 'Target', status: 'invalid-value'}),
 ]));
});

it('detaches provider values and YAML-key provenance before awaiting target I/O', async () => {
 const host = fixture('---\nnumerals: all\n---\n`#: [[Target]].price`');
 const page = {cost: [2, [3, 4]], file: {frontmatter: {oldYaml: 99}}};
 Object.assign(host.app, {plugins: {plugins: {dataview: {api: {page: () => page}}}}});
 let resolve!: (text: string) => void;
 host.read.mockImplementationOnce(() => new Promise<string>(done => {resolve = done;}));
 const pending = host.capture(); (page.cost[1] as number[])[0] = 99; page.file.frontmatter.oldYaml = 0;
 resolve('---\nnumerals: all\nprice: -2\n---'); const input = await pending;
 expect(input.dataview).toMatchObject({status: 'projection', origin: 'page', metadata: {cost: [2, [3, 4]], file: {frontmatter: {oldYaml: 99}}}});
 expect(input.dataview).not.toHaveProperty('evidence');
});

it.each(['selected-getter', 'nonselected-getter', 'own-iterator', 'frontmatter-getter'])('rejects provider array hooks before any copy or await: %s', async kind => {
 const host = fixture('---\nnumerals: all\n---\n`#: [[Target]].price`'), invoked = jest.fn(() => 7);
 const hooked: unknown[] = [1, 2];
 if (kind === 'own-iterator') Object.defineProperty(hooked, Symbol.iterator, {value: invoked});
 else Object.defineProperty(hooked, kind === 'nonselected-getter' ? '0' : '1', {get: invoked});
 const page = {cost: kind === 'frontmatter-getter' ? 4 : hooked, file: {frontmatter: kind === 'frontmatter-getter' ? hooked : {}}};
 Object.assign(host.app, {plugins: {plugins: {dataview: {api: {page: () => page}}}}});
 let resolve!: (text: string) => void;
 host.read.mockImplementationOnce(() => new Promise<string>(done => {resolve = done;}));
 const pending = host.capture(); expect(invoked).not.toHaveBeenCalled();
 resolve('---\nnumerals: all\nprice: -2\n---'); const input = await pending;
 const metadata = captureNoteMetadata({source: host.index.source, engine: host.engine, parseYaml, dataview: input.dataview});
 expect(invoked).not.toHaveBeenCalled(); expect(metadata.entries.find(entry => entry.key === 'cost')).toBeUndefined();
 expect(metadata.warnings.join(' ')).toMatch(/cost|frontmatter/);
});

it('preserves missing provider frontmatter as uncertain provenance rather than fabricating an empty YAML key set', async () => {
 const host = fixture('---\nnumerals: all\n---\n`#: [[Target]].price`');
 Object.assign(host.app, {plugins: {plugins: {dataview: {api: {page: () => ({cost: 9})}}}}});
 const input = await host.capture(), metadata = captureNoteMetadata({source: host.index.source, engine: host.engine, parseYaml, dataview: input.dataview});
 expect(metadata.entries.find(entry => entry.key === 'cost')).toBeUndefined();
 expect(metadata.quarantinedFields).toContain('cost'); expect(metadata.freshness.allowsAutomaticInsertion).toBe(false);
});

it.each(['@format', '@decimalPlaces'])('formatting-only %s references never read or evaluate target metadata', async directive => {
 const host = fixture('```math\n' + directive + ' [[Target]].x\n2 + 3\n```');
 host.buffers.set('Target.md', '---\nnumerals: all\nx: createUnit("formatOnlyUnit", "1 m")\n---');
 const batch = jest.spyOn(references, 'resolveCapturedMetadataReferences'), input = await host.capture();
 expect(input.references).toEqual([]); expect(batch).not.toHaveBeenCalled(); expect(host.read).not.toHaveBeenCalled();
 const snapshot = host.evaluate(input); expect(host.engine.Unit.isValuelessUnit('formatOnlyUnit')).toBe(false);
 expect(snapshot.format(snapshot.calculations[0].calculationId, 1)).toMatchObject({value: {canonical: '5'}});
});

it('a real reference after a transparent row keeps original offsets and captures only its requested property', async () => {
 const host = fixture('> ```math\r\n> @format [[Target]].x\r\n> [[Target]].price ^ 2\r\n> ```');
 host.buffers.set('Target.md', '---\nnumerals: all\nprice: -2\n---');
 const batch = jest.spyOn(references, 'resolveCapturedMetadataReferences'), input = await host.capture();
 const projection = host.index.calculations[0].projection.text;
 expect(batch).toHaveBeenCalledTimes(1); expect(batch.mock.calls[0][0].propertyPaths).toEqual(['price']);
 expect(input.references).toHaveLength(1); expect(input.references[0].start).toBe(projection.indexOf('[[Target]].price'));
 const snapshot = host.evaluate(input); expect(snapshot.format(snapshot.calculations[0].calculationId, 1)).toMatchObject({value: {canonical: '4'}});
});

it('keeps real references after a multiline string whose closing row resembles a formatting directive', async () => {
 const host = fixture('```math\n"prefix\n@format suffix" + [[Target]].price\n```');
 const batch = jest.spyOn(references, 'resolveCapturedMetadataReferences'), input = await host.capture();
 expect(batch).toHaveBeenCalledTimes(1); expect(input.references).toHaveLength(1);
 expect(input.references[0].start).toBe(host.index.calculations[0].projection.text.indexOf('[[Target]].price'));
});
