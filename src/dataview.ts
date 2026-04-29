import { App } from 'obsidian';

export interface DataviewApi {
	page: (path: string) => Record<string, unknown> | undefined;
}

interface AppWithDataview extends App {
	plugins: {
		plugins: {
			dataview?: {
				api?: DataviewApi;
			};
		};
	};
}

interface WindowWithDataview extends Window {
	DataviewAPI?: DataviewApi;
}

export function getDataviewApi(app?: App): DataviewApi | undefined {
	const pluginApi = app
		? (app as AppWithDataview).plugins?.plugins?.dataview?.api
		: undefined;

	return pluginApi ?? (typeof window !== 'undefined'
		? (window as WindowWithDataview).DataviewAPI
		: undefined);
}
