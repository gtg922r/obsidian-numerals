import { CurrencyDisplayMode, DEFAULT_SETTINGS, NumeralsLayout } from '../src/numerals.types';
import { applySettingsPatch, createDefaultSettings, customCurrency, inlineTriggerKeys, normalizeSettings } from '../src/settings/normalization';
import { SettingsChange, SettingsController } from '../src/settings/changes';

describe('complete settings normalization', () => {
	it('isolates nested defaults, saved mappings and returned settings', () => {
		const saved = { dollarSymbolCurrency: { symbol: '$', currency: 'CAD' }, customCurrencySymbol: customCurrency('₿', 'BTC') };
		const a = normalizeSettings(saved), b = normalizeSettings(saved);
		a.dollarSymbolCurrency.currency = 'AUD';
		a.customCurrencySymbol!.currency = 'XYZ';
		expect(b.dollarSymbolCurrency.currency).toBe('CAD');
		expect(saved.customCurrencySymbol.currency).toBe('BTC');
		const first = normalizeSettings(null), second = normalizeSettings(null);
		first.yenSymbolCurrency.currency = 'CNY';
		expect(second.yenSymbolCurrency.currency).toBe('JPY');
		expect(DEFAULT_SETTINGS.yenSymbolCurrency.currency).toBe('JPY');
	});

	it.each([undefined, null, [], false, 'invalid', 3])('handles missing or malformed roots %p', data => {
		expect(normalizeSettings(data)).toEqual(createDefaultSettings());
	});

	it.each([CurrencyDisplayMode.Code, CurrencyDisplayMode.Symbol])('preserves saved display mode %s', mode => {
		expect(normalizeSettings({ currencyDisplayMode: mode }).currencyDisplayMode).toBe(mode);
	});

	it('defaults to symbols only without a valid saved preference', () => {
		expect(normalizeSettings({}).currencyDisplayMode).toBe(CurrencyDisplayMode.Symbol);
		expect(normalizeSettings({ currencyDisplayMode: 'invalid' }).currencyDisplayMode).toBe(CurrencyDisplayMode.Symbol);
	});

	it('repairs invalid types, ranges, mappings and custom metadata without mutating input', () => {
		const saved = { enableInlineNumerals: 'true', numberFormat: 7, customCurrencyDecimalPlaces: 21,
			dollarSymbolCurrency: { currency: 'CAD' }, yenSymbolCurrency: { symbol: 'wrong', currency: 'JPY' },
			customCurrencySymbol: { symbol: '₿', currency: 'BTC', name: '\\unsafe', unicode: 'unsafe' } };
		const actual = normalizeSettings(saved);
		expect(actual.enableInlineNumerals).toBe(true);
		expect(actual.numberFormat).toBe(DEFAULT_SETTINGS.numberFormat);
		expect(actual.customCurrencyDecimalPlaces).toBe(2);
		expect(actual.dollarSymbolCurrency).toEqual({ symbol: '$', currency: 'CAD' });
		expect(actual.yenSymbolCurrency).toEqual(DEFAULT_SETTINGS.yenSymbolCurrency);
		expect(actual.customCurrencySymbol).toEqual(customCurrency('₿', 'BTC'));
		expect(saved.customCurrencySymbol.name).toBe('\\unsafe');
	});

	it.each([-1, 21, 1.5, NaN, Infinity, '2', null])('repairs invalid precision %p', customCurrencyDecimalPlaces => {
		expect(normalizeSettings({ customCurrencyDecimalPlaces }).customCurrencyDecimalPlaces).toBe(2);
	});
	it.each([0, 20])('keeps precision boundary %i', customCurrencyDecimalPlaces => {
		expect(normalizeSettings({ customCurrencyDecimalPlaces }).customCurrencyDecimalPlaces).toBe(customCurrencyDecimalPlaces);
	});
	it.each([0, 1, 2, 3])('migrates numeric layout %i', layoutStyle => {
		expect(normalizeSettings({ layoutStyle }).layoutStyle).toBe(Object.values(NumeralsLayout)[layoutStyle]);
	});
	it.each([1, 2, 3])('migrates oldest renderStyle %i', renderStyle => {
		expect(normalizeSettings({ renderStyle }).layoutStyle).toBe(Object.values(NumeralsLayout)[renderStyle - 1]);
	});
	it('migrates a legacy layout when the newer key is null', () => {
		expect(normalizeSettings({ layoutStyle: null, renderStyle: 2 }).layoutStyle).toBe(NumeralsLayout.AnswerRight);
	});
	it('keeps modern layouts ahead of legacy values', () => {
		expect(normalizeSettings({ layoutStyle: NumeralsLayout.AnswerInline, renderStyle: 1 }).layoutStyle).toBe(NumeralsLayout.AnswerInline);
	});
	it('preserves prefix overlaps and empty disable, while repairing exact duplicates', () => {
		const settings = normalizeSettings({ inlineResultTrigger: '#', inlineEquationTrigger: '#=', inlineTexResultTrigger: '', inlineTexEquationTrigger: '#=' });
		expect(inlineTriggerKeys.map(key => settings[key])).toEqual(['#', '#=', '', '']);
		expect(() => applySettingsPatch(settings, { inlineTexResultTrigger: '#' })).toThrow('exact trigger');
		expect(applySettingsPatch(settings, { inlineTexResultTrigger: '#$' }).inlineTexResultTrigger).toBe('#$');
	});
	it('lets a saved trigger take precedence over a missing default', () => {
		const settings = normalizeSettings({ inlineEquationTrigger: '#:' });
		expect(settings.inlineEquationTrigger).toBe('#:');
		expect(settings.inlineResultTrigger).toBe('');
	});
	it('accepts atomic trigger swaps and rejects invalid persisted edits', () => {
		const settings = createDefaultSettings();
		expect(applySettingsPatch(settings, { inlineResultTrigger: '#=:', inlineEquationTrigger: '#:' }).inlineResultTrigger).toBe('#=:');
		expect(() => applySettingsPatch(settings, { enableInlineNumerals: 'yes' })).toThrow('valid value');
	});
});

describe('typed settings change boundary', () => {
	const runtime = () => {
		const activate = jest.fn(), discard = jest.fn();
		return { prepare: jest.fn((_settings: ReturnType<typeof createDefaultSettings>) => ({ activate, dispose: discard })), activate, discard, dispose: jest.fn() };
	};
	it('separates presentation and suggestions from evaluation generations', async () => {
		const active = runtime(), save = jest.fn().mockResolvedValue(undefined);
		const controller = new SettingsController(null, active, save);
		const changes: SettingsChange[] = [];
		controller.subscribe(change => changes.push(change));
		await controller.update({ currencyDisplayMode: CurrencyDisplayMode.Code });
		await controller.update({ provideSuggestions: false });
		await controller.update({ inlineResultTrigger: 'calc:' });
		expect(changes.map(change => [...change.effects])).toEqual([['presentation'], ['suggestions'], ['evaluation']]);
		expect(changes.map(change => change.evaluationGeneration)).toEqual([0, 0, 1]);
		expect(save).toHaveBeenCalledTimes(3);
	});
	it('rejects activation failures without saving or publishing a changed mapping', async () => {
		const active = runtime(), save = jest.fn().mockResolvedValue(undefined);
		const controller = new SettingsController(null, active, save);
		active.prepare.mockImplementationOnce(() => { throw new Error('Unit collision'); });
		await expect(controller.update({ customCurrencySymbol: customCurrency('₿', 'm') })).rejects.toThrow('collision');
		expect(controller.settings.customCurrencySymbol).toBeNull();
		expect(save).not.toHaveBeenCalled();
	});
	it('keeps settings and runtime unchanged on persistence failure, and accepts the next edit', async () => {
		const active = runtime(), save = jest.fn().mockRejectedValueOnce(new Error('Disk failed')).mockResolvedValue(undefined);
		const controller = new SettingsController(null, active, save);
		const changes: SettingsChange[] = [];
		controller.subscribe(change => changes.push(change));
		await expect(controller.update({ inlineResultTrigger: 'calc:' })).rejects.toThrow('Disk failed');
		expect(controller.settings.inlineResultTrigger).toBe('#:');
		expect(active.activate).toHaveBeenCalledTimes(1);
		expect(active.discard).toHaveBeenCalledTimes(1);
		expect(changes).toEqual([]);
		await controller.update({ provideSuggestions: false });
		expect(controller.settings.provideSuggestions).toBe(false);
	});
	it('discards pending activation and queued edits when unloaded during persistence', async () => {
		let finishSave!: () => void;
		const saved = new Promise<void>(resolve => { finishSave = resolve; });
		const active = runtime(), controller = new SettingsController(null, active, () => saved), listener = jest.fn();
		controller.subscribe(listener);
		const first = controller.update({ inlineResultTrigger: 'calc:' });
		const queued = controller.update({ provideSuggestions: false });
		await Promise.resolve();
		expect(active.prepare).toHaveBeenCalledTimes(2);
		controller.dispose(); finishSave();
		await first;
		await expect(queued).rejects.toThrow('unloaded');
		expect(active.activate).toHaveBeenCalledTimes(1);
		expect(active.discard).toHaveBeenCalledTimes(1);
		expect(listener).not.toHaveBeenCalled();
	});
	it('serializes rapid edits against the latest settings and disposes subscriptions', async () => {
		const active = runtime(), save = jest.fn().mockResolvedValue(undefined);
		const controller = new SettingsController(null, active, save), listener = jest.fn();
		const unsubscribe = controller.subscribe(listener);
		await Promise.all([controller.update({ provideSuggestions: false }), controller.update({ provideInlineSuggestions: false })]);
		expect(controller.settings.provideSuggestions).toBe(false);
		expect(controller.settings.provideInlineSuggestions).toBe(false);
		unsubscribe();
		controller.dispose();
		await expect(controller.update({ provideSuggestions: true })).rejects.toThrow('unloaded');
		expect(active.dispose).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledTimes(2);
	});
});
