import { App, SettingDefinitionItem } from 'obsidian';
import { NumeralsSettingTab, NumeralsSettingsHost } from '../src/settings';
import { CurrencyMappingModal } from '../src/settings/currencyModal';
import { SettingsController } from '../src/settings/changes';
import { NumeralsSettingsRuntime } from '../src/settings/runtimeState';
import { createDefaultSettings, customCurrency } from '../src/settings/normalization';

jest.mock('obsidian', () => {
	class ButtonComponent {
		buttonEl: HTMLButtonElement;
		constructor(container: HTMLElement) { this.buttonEl = container.appendChild(document.createElement('button')); }
		setButtonText(text: string) { this.buttonEl.textContent = text; return this; }
		setCta() { return this; }
		setDisabled(value: boolean) { this.buttonEl.disabled = value; return this; }
		onClick(callback: () => void | Promise<void>) { this.buttonEl.addEventListener('click', () => { void callback(); }); return this; }
	}
	class TextControl {
		inputEl: HTMLInputElement;
		constructor(container: HTMLElement) { this.inputEl = container.appendChild(document.createElement('input')); }
		setValue(value: string) { this.inputEl.value = value; return this; }
		onChange(callback: (value: string) => void) { this.inputEl.addEventListener('input', () => callback(this.inputEl.value)); return this; }
	}
	class DropdownControl {
		inputEl: HTMLSelectElement;
		constructor(container: HTMLElement) { this.inputEl = container.appendChild(document.createElement('select')); }
		addOptions(options: Record<string, string>) { for (const [value, text] of Object.entries(options)) this.inputEl.add(new Option(text, value)); return this; }
		setValue(value: string) { this.inputEl.value = value; return this; }
		onChange(callback: (value: string) => void) { this.inputEl.addEventListener('change', () => callback(this.inputEl.value)); return this; }
	}
	return {
		Plugin: class {},
		PluginSettingTab: class {
			app: App;
			constructor(app: App) { this.app = app; }
			refreshDomState = jest.fn(); update = jest.fn();
		},
		Modal: class {
			contentEl = document.body.appendChild(document.createElement('section'));
			title = '';
			setTitle(value: string) { this.title = value; return this; }
			open() { (this as unknown as CurrencyMappingModal).onOpen(); }
			close() { (this as unknown as CurrencyMappingModal).onClose(); }
		},
		Setting: class {
			settingEl: HTMLElement;
			constructor(container: HTMLElement) { this.settingEl = container.appendChild(document.createElement('div')); }
			setName(text: string) { this.settingEl.setAttribute('aria-label', text); return this; }
			setDesc(_text: string) { return this; }
			addText(callback: (control: TextControl) => unknown) { callback(new TextControl(this.settingEl)); return this; }
			addDropdown(callback: (control: DropdownControl) => unknown) { callback(new DropdownControl(this.settingEl)); return this; }
		},
		ButtonComponent,
	};
});

beforeAll(() => {
	HTMLElement.prototype.empty = function () { this.replaceChildren(); };
	HTMLElement.prototype.setText = function (text: string) { this.textContent = text; };
	HTMLElement.prototype.createDiv = function (options?: DomElementInfo | string) {
		const element = this.ownerDocument.createElement('div');
		if (typeof options === 'object' && typeof options.cls === 'string') element.className = options.cls;
		this.appendChild(element); return element;
	};
});
beforeEach(() => document.body.replaceChildren());
const app = {} as App;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function click(text: string): void {
	const button = Array.from(document.querySelectorAll('button')).find(button => button.textContent === text)!;
	button.click();
}
function input(index: number, value: string): void {
	const element = document.querySelectorAll('input')[index]; element.value = value; element.dispatchEvent(new Event('input'));
}
function flatten(items: SettingDefinitionItem[]): SettingDefinitionItem[] {
	return items.flatMap(item => 'items' in item && Array.isArray(item.items) ? flatten(item.items) : [item]);
}

describe('declarative settings completeness', () => {
	it('defines every current setting once and keeps the five protected controls searchable', () => {
		const host = { settings: createDefaultSettings(), updateSettings: jest.fn().mockResolvedValue(undefined) } as unknown as NumeralsSettingsHost;
		const tab = new NumeralsSettingTab(app, host);
		const definitions = flatten(tab.getSettingDefinitions());
		const keys = definitions.flatMap(item => 'control' in item && item.control ? [item.control.key] : 'aliases' in item ? item.aliases?.filter(alias => alias in host.settings) ?? [] : []);
		expect(keys.sort()).toEqual(Object.keys(host.settings).sort());
		for (const key of ['currencyPrecisionMode', 'currencyDisplayMode', 'customCurrencyDecimalPlaces', 'inlineTexResultTrigger', 'inlineTexEquationTrigger']) {
			const item = definitions.find(item => 'control' in item && item.control?.key === key)!;
			expect('name' in item && item.name).toBeTruthy();
			expect('visible' in item ? item.visible : undefined).toBeUndefined();
		}
		expect(Object.prototype.hasOwnProperty.call(NumeralsSettingTab.prototype, 'display')).toBe(false);
	});
	it('keeps invalid loaded currency settings searchable and supports explicit removal', async () => {
		const runtime = new NumeralsSettingsRuntime(() => []);
		const controller = new SettingsController({ customCurrencySymbol: customCurrency('₿', 'm') }, runtime, async () => undefined);
		const host = {
			get settings() { return controller.settings; },
			get configurationError() { return runtime.configurationError; },
			updateSettings: (patch: Record<string, unknown>) => controller.update(patch),
		} as unknown as NumeralsSettingsHost;
		const tab = new NumeralsSettingTab(app, host);
		expect(flatten(tab.getSettingDefinitions()).some(item => 'name' in item && item.name === 'Currency configuration needs attention')).toBe(true);
		new CurrencyMappingModal(app, 'customCurrencySymbol', host.settings, patch => host.updateSettings(patch)).onOpen();
		expect(document.querySelectorAll('input')[1].value).toBe('m');
		click('Remove mapping'); await flush(); await flush();
		expect(host.settings.customCurrencySymbol).toBeNull();
		expect(host.configurationError).toBeUndefined();
		expect(flatten(tab.getSettingDefinitions()).some(item => 'name' in item && item.name === 'Currency configuration needs attention')).toBe(false);
		controller.dispose();
	});
	it('routes declarative changes through the shared update boundary', async () => {
		const updateSettings = jest.fn().mockResolvedValue(undefined);
		const host = { settings: createDefaultSettings(), updateSettings } as unknown as NumeralsSettingsHost;
		const tab = new NumeralsSettingTab(app, host);
		await tab.setControlValue('currencyDisplayMode', 'code');
		expect(updateSettings).toHaveBeenCalledWith({ currencyDisplayMode: 'code' });
		updateSettings.mockRejectedValueOnce(new Error('Invalid trigger'));
		await expect(tab.setControlValue('inlineResultTrigger', '#=:')).rejects.toThrow('Invalid trigger');
	});
});

describe('currency form modal', () => {
	it('keeps partial edits local and discards them on Cancel', async () => {
		const save = jest.fn().mockResolvedValue(undefined), settings = createDefaultSettings();
		const modal = new CurrencyMappingModal(app, 'customCurrencySymbol', settings, save); modal.onOpen();
		input(0, '₿'); input(1, 'BTC');
		expect(save).not.toHaveBeenCalled(); click('Cancel'); await flush();
		expect(save).not.toHaveBeenCalled(); expect(settings.customCurrencySymbol).toBeNull();
	});
	it('validates all fields and commits exactly once on Save', async () => {
		const save = jest.fn().mockResolvedValue(undefined);
		new CurrencyMappingModal(app, 'customCurrencySymbol', createDefaultSettings(), save).onOpen();
		input(0, '₿'); click('Save'); await flush();
		expect(save).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')!.textContent).toContain('currency code');
		input(1, 'BTC'); click('Save'); click('Save'); await flush();
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith({ customCurrencySymbol: customCurrency('₿', 'BTC') });
	});
	it('provides an explicit remove action', async () => {
		const save = jest.fn().mockResolvedValue(undefined), settings = createDefaultSettings();
		settings.customCurrencySymbol = customCurrency('₿', 'BTC');
		new CurrencyMappingModal(app, 'customCurrencySymbol', settings, save).onOpen();
		click('Remove mapping'); await flush();
		expect(save).toHaveBeenCalledWith({ customCurrencySymbol: null });
	});
	it('keeps failed currency changes editable with an actionable error', async () => {
		const save = jest.fn().mockRejectedValue(new Error('Currency name m already identifies a mathjs unit; choose another code.'));
		new CurrencyMappingModal(app, 'customCurrencySymbol', createDefaultSettings(), save).onOpen();
		input(0, '₿'); input(1, 'm'); click('Save'); await flush();
		expect(document.querySelector('[role="alert"]')!.textContent).toContain('choose another code');
		expect(document.querySelectorAll('input')).toHaveLength(2);
		expect(Array.from(document.querySelectorAll('button')).every(button => !button.disabled)).toBe(true);
	});
	it('holds built-in currency choices until explicit Save', async () => {
		const save = jest.fn().mockResolvedValue(undefined);
		new CurrencyMappingModal(app, 'dollarSymbolCurrency', createDefaultSettings(), save).onOpen();
		const select = document.querySelector('select')!; select.value = 'CAD'; select.dispatchEvent(new Event('change'));
		expect(save).not.toHaveBeenCalled(); click('Save'); await flush();
		expect(save).toHaveBeenCalledWith({ dollarSymbolCurrency: { symbol: '$', currency: 'CAD' } });
	});
});
