import { App, ButtonComponent, Modal, Setting } from 'obsidian';
import { customCurrency } from './normalization';
import type { NumeralsSettings } from '../numerals.types';
import { currencyCodesForDollarSign, currencyCodesForYenSign } from './currencies';

type CurrencyKey = 'dollarSymbolCurrency' | 'yenSymbolCurrency' | 'customCurrencySymbol';

/** Multi-field currency drafts only reach the shared save path on explicit Save. */
export class CurrencyMappingModal extends Modal {
	private symbol: string;
	private currency: string;
	private pending = false;
	private closed = false;
	private errorEl!: HTMLElement;
	private buttons: ButtonComponent[] = [];

	constructor(app: App, private readonly key: CurrencyKey, settings: NumeralsSettings,
		private readonly save: (patch: Record<string, unknown>) => Promise<void>) {
		super(app);
		this.symbol = settings[key]?.symbol ?? '';
		this.currency = settings[key]?.currency ?? '';
		this.setTitle(key === 'customCurrencySymbol' ? 'Custom currency mapping' : `${this.symbol} currency mapping`);
	}

	onOpen(): void {
		this.closed = false;
		this.contentEl.empty();
		if (this.key === 'customCurrencySymbol') {
			new Setting(this.contentEl).setName('Symbol').setDesc('Enter one currency symbol.')
				.addText(text => text.setValue(this.symbol).onChange(value => { this.symbol = value; }));
			new Setting(this.contentEl).setName('Currency code').setDesc('Use a unique code starting with a letter.')
				.addText(text => text.setValue(this.currency).onChange(value => { this.currency = value; }));
		} else {
			const codes = this.key === 'dollarSymbolCurrency' ? currencyCodesForDollarSign : currencyCodesForYenSign;
			new Setting(this.contentEl).setName('Currency').addDropdown(dropdown => dropdown
				.addOptions(Object.fromEntries(Object.entries(codes).map(([code, name]) => [code, `${code} (${name})`]))).setValue(this.currency).onChange(value => { this.currency = value; }));
		}
		this.errorEl = this.contentEl.createDiv({ cls: 'mod-warning' });
		this.errorEl.setAttribute('role', 'alert');
		const buttonsEl = this.contentEl.createDiv({ cls: 'modal-button-container' });
		this.buttons = [];
		if (this.key === 'customCurrencySymbol') {
			this.buttons.push(new ButtonComponent(buttonsEl).setButtonText('Remove mapping')
				.onClick(() => this.submit(true)));
		}
		this.buttons.push(new ButtonComponent(buttonsEl).setButtonText('Cancel').onClick(() => this.close()));
		this.buttons.push(new ButtonComponent(buttonsEl).setButtonText('Save').setCta().onClick(() => this.submit(false)));
	}

	private async submit(remove: boolean): Promise<void> {
		if (this.pending || this.closed) return;
		this.pending = true;
		for (const button of this.buttons) button.setDisabled(true);
		try {
			const value = this.key === 'customCurrencySymbol'
				? (remove ? null : customCurrency(this.symbol, this.currency))
				: { symbol: this.symbol, currency: this.currency };
			await this.save({ [this.key]: value });
			this.close();
		} catch (error) {
			if (!this.closed) this.errorEl.setText(error instanceof Error ? error.message : 'Unable to save the currency mapping.');
		} finally {
			this.pending = false;
			for (const button of this.buttons) button.setDisabled(false);
		}
	}

	onClose(): void { this.closed = true; this.contentEl.empty(); }
}
