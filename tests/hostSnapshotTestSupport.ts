import type { Editor } from 'obsidian';
import { all, create } from 'mathjs';
import { SnapshotCoordinator, type SourceOwner, type SnapshotConfiguration } from '../src/host/snapshotCoordinator';
import { createDefaultSettings } from '../src/settings/normalization';
import { createNumberFormatProfile, createResultFormatter } from '../src/formatting';
import { sourceLineAt, sourceLineStarts } from '../src/evaluation/sourceIndex';

const {load: parseYaml} = jest.requireActual<{load(text: string): unknown}>('js-yaml');
export const flushSnapshots = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
export function snapshotFixture(source: string) {
	let text = source, attached = true;
	let file = {path: 'source.md'};
	const engine = create(all, {randomSeed: 'numerals-g-insertion-cycle'});
	const settings = createDefaultSettings();
	const formatter = createResultFormatter({runtime: engine, profile: createNumberFormatProfile(settings.numberFormat, 'en-US', engine)});
	let configuration: SnapshotConfiguration = {settings, runtime: {engine, formatter, configurationError: undefined,
		currencyGeneration: 0, currencyMap: [], currencyWarnings: [], preProcessors: []}, settingsGeneration: 0, evaluationSettingsGeneration: 0};
	const transaction = jest.fn((tx: {changes: {from: {line: number; ch: number}; to: {line: number; ch: number}; text: string}[]}) => {
		const starts = sourceLineStarts(text);
		for (const change of tx.changes.slice().reverse()) {
			const from = starts[change.from.line] + change.from.ch, to = starts[change.to.line] + change.to.ch;
			text = text.slice(0, from) + change.text + text.slice(to);
		}
	});
	const editor = {transaction, offsetToPos: (offset: number) => {
		const starts = sourceLineStarts(text), line = sourceLineAt(starts, offset);
		return {line, ch: offset - starts[line]};
	}} as unknown as Editor;
	const owner: SourceOwner = {identity: editor, editor, file: () => file, text: () => text, attached: () => attached};
	const capture = jest.fn(() => ({parseYaml}));
	const coordinator = new SnapshotCoordinator({configuration: () => configuration, capture});
	coordinator.attach(owner);
	return {coordinator, editor, owner, engine, capture, transaction,
		text: () => text, setText: (value: string) => {text = value;}, setAttached: (value: boolean) => {attached = value;},
		setFile: (value: typeof file) => {file = value;},
		configuration: () => configuration, configure: (value: SnapshotConfiguration) => {configuration = value;}};
}
