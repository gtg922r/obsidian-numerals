import { createTestHost } from './hostTestSupport';
import NumeralsPlugin from '../src/main';
import { Notice, PluginManifest, renderMath, loadMathJax } from 'obsidian';
import { createDefaultSettings, customCurrency } from '../src/settings/normalization';
import { evaluateMathFromSourceStrings } from '../src/processing/evaluator';
import { NumeralsScope, CurrencyDisplayMode, NumeralsNumberFormat } from '../src/numerals.types';
import { getMathRuntime } from '../src/mathRuntime';

jest.mock('../src/NumeralsSuggestor', () => ({ NumeralsSuggestor: class {} }));
jest.mock('../src/inline', () => ({ createInlineNumeralsPostProcessor: jest.fn(() => Object.assign(jest.fn(), { dispose: jest.fn() })), createInlineLivePreviewExtension: jest.fn() }));
jest.mock('../src/host/captureInputs', () => ({captureHostInputs: jest.fn()}), {virtual: true});
jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));
const plugins: NumeralsPlugin[] = [];
function plugin(data: unknown = undefined) {
	const instance = new NumeralsPlugin(createTestHost().app, {} as PluginManifest);
	jest.mocked(instance.loadData).mockResolvedValue(data);
	plugins.push(instance); return instance;
}
afterEach(() => { for (const instance of plugins.splice(0)) instance.unload(); jest.clearAllMocks(); });

it('loads committed snapshots and routes presentation/runtime saves atomically', async () => {
	const instance = plugin(); await instance.onload();
	const first = instance.getRuntimeContext();
	instance.settings.dollarSymbolCurrency.currency = 'AUD';
	expect(instance.settings.dollarSymbolCurrency.currency).toBe('USD');
	const listener = jest.fn(); const unsubscribe = instance.subscribeSettingsChanges(listener);
	await instance.saveSettings({ currencyDisplayMode: CurrencyDisplayMode.Code });
	expect(instance.getRuntimeContext().engine).toBe(first.engine);
	expect(instance.evaluationSettingsGeneration).toBe(0);
	await instance.updateSettings({ provideSuggestions: false });
	expect(instance.evaluationSettingsGeneration).toBe(0);
	jest.mocked(instance.saveData).mockRejectedValueOnce(new Error('Disk unavailable'));
	const beforeFailure = instance.getRuntimeContext();
	await expect(instance.updateSettings({ dollarSymbolCurrency: { symbol: '$', currency: 'CAD' } })).rejects.toThrow('Disk unavailable');
	expect(instance.getRuntimeContext()).toBe(beforeFailure);
	expect(instance.settings.dollarSymbolCurrency.currency).toBe('USD');
	await instance.updateSettings({ dollarSymbolCurrency: { symbol: '$', currency: 'CAD' } });
	expect(instance.settingsGeneration).toBe(3);
	expect(instance.evaluationSettingsGeneration).toBe(1);
	expect(instance.getRuntimeContext().currencyGeneration).toBe(2);
	expect(listener).toHaveBeenCalledTimes(3); unsubscribe();
	expect(renderMath).not.toHaveBeenCalled();
});

it('keeps invalid saved mapping editable, emits one notice, and blocks calculation until explicit repair', async () => {
	const saved = { ...createDefaultSettings(), customCurrencySymbol: customCurrency('₿', 'm') };
	const instance = plugin(saved); await instance.onload();
	expect(instance.settings.customCurrencySymbol?.currency).toBe('m');
	expect(instance.configurationError).toContain('Numerals settings');
	expect(instance.addSettingTab).toHaveBeenCalledTimes(1);
	expect(instance.saveData).not.toHaveBeenCalled();
	for (let i = 0; i < 2; i++) {
		const result = evaluateMathFromSourceStrings('1 + 2', new NumeralsScope());
		expect(result.errorMsg?.message).toContain('Numerals settings');
	}
	expect(Notice).toHaveBeenCalledTimes(1);
	await instance.updateSettings({ customCurrencySymbol: null });
	expect(instance.configurationError).toBeUndefined();
	expect(evaluateMathFromSourceStrings('1 + 2', new NumeralsScope()).results).toEqual([3]);
});

it('disposes subscriptions and the active engine on unload, then reloads the saved mapping cleanly', async () => {
	const instance = plugin(); await instance.onload();
	const engine = instance.getRuntimeContext().engine;
	instance.unload();
	expect(getMathRuntime()).not.toBe(engine);
	await expect(instance.updateSettings({ resultSeparator: '=' })).rejects.toThrow('unloaded');
	const saved = createDefaultSettings(); saved.dollarSymbolCurrency.currency = 'CAD';
	jest.mocked(instance.loadData).mockResolvedValue(saved); await instance.onload();
	expect(instance.getRuntimeContext().engine.unit('1$').toNumber('CAD')).toBe(1);
	expect(instance.getRuntimeContext().engine.Unit.isValuelessUnit('USD')).toBe(false);
});

it('does not activate a runtime when unload happens during data loading', async () => {
	const instance = plugin(); const before = getMathRuntime();
	let resolve!: (data: unknown) => void;
	jest.mocked(instance.loadData).mockReturnValueOnce(new Promise(done => { resolve = done; }));
	const loading = instance.onload(); instance.unload(); resolve(undefined); await loading;
	expect(getMathRuntime()).toBe(before);
	expect(instance.addSettingTab).not.toHaveBeenCalled();
});

it('registers repair and surfaces before MathJax completes, with no late work after unload', async () => {
	const instance = plugin();
	let resolve!: () => void;
	jest.mocked(loadMathJax).mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
	const loading = instance.onload();
	await Promise.resolve(); await Promise.resolve();
	const engine = instance.getRuntimeContext().engine;
	instance.unload(); resolve(); await loading;
	expect(getMathRuntime()).not.toBe(engine);
	expect(instance.addSettingTab).toHaveBeenCalledTimes(1);
	expect(instance.registerMarkdownCodeBlockProcessor).toHaveBeenCalledTimes(6);
});

it('formats tiny numbers with the new engine after remapping, including locale overrides', async () => {
	const instance = plugin(); await instance.onload();
	const old = instance.getRuntimeContext().engine;
	await instance.updateSettings({ dollarSymbolCurrency: { symbol: '$', currency: 'CAD' } });
	const context = instance.getRuntimeContext();
	const oldFormat = jest.spyOn(old, 'format');
	const currentFormat = jest.spyOn(context.engine, 'format');
	context.formatter.format(1e-10);
	context.formatter.format(1e-10, { numberFormat: NumeralsNumberFormat.Format_CommaThousands_PeriodDecimal });
	expect(oldFormat).not.toHaveBeenCalled();
	expect(currentFormat).toHaveBeenCalled();
});


it('keeps settings repair available when MathJax loading rejects', async () => {
 const instance = plugin(); jest.mocked(loadMathJax).mockRejectedValueOnce(new Error('offline MathJax'));
 await instance.onload();
 expect(instance.addSettingTab).toHaveBeenCalledTimes(1);
 expect(instance.registerMarkdownCodeBlockProcessor).toHaveBeenCalledTimes(6);
 expect(Notice).toHaveBeenCalledWith(expect.stringContaining('offline MathJax'));
 await instance.updateSettings({resultSeparator: ' equals '});
 expect(instance.settings.resultSeparator).toBe(' equals ');
});
