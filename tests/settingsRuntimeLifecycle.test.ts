import { SettingsController } from '../src/settings/changes';
import { NumeralsSettingsRuntime } from '../src/settings/runtimeState';
import { CurrencyDisplayMode } from '../src/numerals.types';
import { getMathRuntime } from '../src/mathRuntime';
import { customCurrency } from '../src/settings/normalization';

const runtime = () => new NumeralsSettingsRuntime(() => []);

describe('settings/runtime lifecycle integration', () => {
	it.each(['repair', 'remove'])('keeps invalid saved mappings editable and blocks evaluation until %s', async action => {
		const active = runtime(), save = jest.fn().mockResolvedValue(undefined);
		const stored = { customCurrencySymbol: customCurrency('₿', 'm') };
		const controller = new SettingsController(stored, active, save);
		expect(controller.settings.customCurrencySymbol).toEqual(stored.customCurrencySymbol);
		expect(active.configurationError).toContain('Numerals settings');
		expect(() => getMathRuntime().evaluate('2 + 2')).toThrow('Numerals settings');
		expect(save).not.toHaveBeenCalled();
		await controller.update({ customCurrencySymbol: action === 'repair' ? customCurrency('₿', 'BTC') : null });
		expect(active.configurationError).toBeUndefined();
		expect(getMathRuntime().evaluate('2 + 2')).toBe(4);
		if (action === 'repair') expect(getMathRuntime().evaluate('unit("1₿")').toNumber('BTC')).toBe(1);
		else expect(getMathRuntime().Unit.isValuelessUnit('₿')).toBe(false);
		expect(stored.customCurrencySymbol.currency).toBe('m');
		controller.dispose();
	});
	it('activates mapping, formatter and generation only after a successful save', async () => {
		let finish!: () => void;
		const save = new Promise<void>(resolve => { finish = resolve; });
		const active = runtime(), controller = new SettingsController(null, active, () => save);
		const oldContext = active.context, events = jest.fn(); controller.subscribe(events);
		const saving = controller.update({ dollarSymbolCurrency: { symbol: '$', currency: 'CAD' } });
		await Promise.resolve();
		expect(active.context).toBe(oldContext);
		expect(controller.settings.dollarSymbolCurrency.currency).toBe('USD');
		expect(getMathRuntime()).toBe(oldContext.engine);
		finish(); await saving;
		expect(active.context.engine.evaluate('unit("1$")').toNumber('CAD')).toBe(1);
		expect(active.context.formatter.format(active.context.engine.evaluate('1$')).canonical).toBe('1.00 CAD');
		expect(events).toHaveBeenCalledTimes(1);
		expect(active.context.currencyGeneration).toBe(oldContext.currencyGeneration + 1);
		controller.dispose();
	});
	it('leaves the active runtime, formatter and settings untouched when persistence fails', async () => {
		const active = runtime(), controller = new SettingsController(null, active, async () => { throw new Error('Disk failed'); });
		const oldContext = active.context;
		await expect(controller.update({ customCurrencySymbol: customCurrency('₿', 'BTC') })).rejects.toThrow('Disk failed');
		expect(active.context).toBe(oldContext);
		expect(getMathRuntime()).toBe(oldContext.engine);
		expect(controller.settings.customCurrencySymbol).toBeNull();
		expect(active.context.engine.Unit.isValuelessUnit('₿')).toBe(false);
		controller.dispose();
	});
	it('reformats without recreating the engine, reevaluating source, or rounding raw scope values', async () => {
		const active = runtime(), controller = new SettingsController(null, active, async () => undefined);
		const initial = active.context, scope = new Map<string, unknown>();
		initial.engine.evaluate('price = 1.23456789 USD', scope);
		const evaluate = jest.spyOn(initial.engine, 'evaluate');
		await controller.update({ currencyDisplayMode: CurrencyDisplayMode.Code });
		expect(active.context.engine).toBe(initial.engine);
		expect(active.context.currencyGeneration).toBe(initial.currencyGeneration);
		expect(evaluate).not.toHaveBeenCalled();
		expect(active.context.formatter.format(scope.get('price')).text).toBe('1.23 USD');
		expect(initial.engine.unit(scope.get('price') as string).toNumber('USD')).toBe(1.23456789);
		controller.dispose();
	});
	it('keeps an old formatter usable through remapping, then cleans up hooks on unload/reload', async () => {
		const active = runtime(), controller = new SettingsController(null, active, async () => undefined);
		const old = active.context, oldValue = old.engine.evaluate('unit("1$")');
		await controller.update({ dollarSymbolCurrency: { symbol: '$', currency: 'CAD' } });
		expect(old.formatter.format(oldValue).canonical).toBe('1.00 USD');
		const retiredParse = old.engine.parse;
		controller.dispose();
		expect(retiredParse.isAlpha('€', '', '')).toBe(false);
		expect(getMathRuntime()).not.toBe(old.engine);
		const reload = runtime(), reloaded = new SettingsController(null, reload, async () => undefined);
		expect(reload.context.engine.evaluate('unit("1$")').toNumber('USD')).toBe(1);
		reloaded.dispose();
	});
});
