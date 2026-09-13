import { createTestHost } from './hostTestSupport';
import { HostEventHub } from '../src/host/events';

jest.mock('obsidian', () => jest.requireActual('./snapshotHostMock'));

it('normalizes native and DV events independently, including late DV readiness and vault topology', () => {
	const host = createTestHost(), hub = new HostEventHub(host.app), receive = jest.fn();
	const stop = hub.subscribe(receive);
	host.cacheEvents.fire('changed', { path: 'native.md' }, 'raw text', { frontmatter: {} });
	host.cacheEvents.fire('dataview:metadata-change', 'update', { path: 'dv.md' });
	host.cacheEvents.fire('dataview:api-ready');
	host.vaultEvents.fire('create', { path: 'new.md' }); host.vaultEvents.fire('delete', { path: 'deleted.md' });
	host.vaultEvents.fire('rename', { path: 'new-name.md' }, 'old-name.md');
	expect(receive.mock.calls.map(([event]) => event)).toEqual([
		{ kind: 'metadata', paths: ['native.md'] }, { kind: 'dataview', paths: ['dv.md'] }, { kind: 'ready', paths: [] },
		{ kind: 'create', paths: ['new.md'] }, { kind: 'delete', paths: ['deleted.md'] },
		{ kind: 'rename', paths: ['old-name.md', 'new-name.md'], oldPath: 'old-name.md', newPath: 'new-name.md' },
	]);
	stop(); expect(host.cacheEvents.size + host.vaultEvents.size).toBe(0);
	hub.dispose();
});

it('queues nested renames in causal order and skips subscriptions removed during delivery', async () => {
	const host = createTestHost();
	// The first direct hub subscriber emits the next rename while the first is delivered.
	const hub = new HostEventHub(host.app);
	hub.subscribe(event => { if (event.kind === 'rename' && event.oldPath === 'A.md') host.vaultEvents.fire('rename', { path: 'C.md' }, 'B.md'); });
	const paths: string[] = []; let path = 'A.md';
	hub.subscribe(event => { if (event.kind === 'rename' && path === event.oldPath) path = event.newPath; paths.push(path); });
	host.vaultEvents.fire('rename', { path: 'B.md' }, 'A.md');
	expect(paths).toEqual(['B.md', 'C.md']);
	let stopSecond = () => {}; const second = jest.fn();
	const stopFirst = hub.subscribe(() => stopSecond()); stopSecond = hub.subscribe(second);
	host.cacheEvents.fire('changed', { path: 'source.md' }, '', {}); expect(second).not.toHaveBeenCalled();
	stopFirst(); hub.dispose();
});

it('owns duplicate callback registrations independently without connecting duplicate host listeners', () => {
	const host = createTestHost(), hub = new HostEventHub(host.app), listener = jest.fn();
	const stopFirst = hub.subscribe(listener), stopSecond = hub.subscribe(listener);
	expect(host.cacheEvents.size).toBe(3); expect(host.vaultEvents.size).toBe(3);
	host.cacheEvents.fire('changed', { path: 'A.md' }, '', {}); expect(listener).toHaveBeenCalledTimes(2);
	stopFirst(); stopFirst(); host.cacheEvents.fire('changed', { path: 'A.md' }, '', {}); expect(listener).toHaveBeenCalledTimes(3);
	expect(host.cacheEvents.size).toBe(3); stopSecond(); expect(host.cacheEvents.size + host.vaultEvents.size).toBe(0);
	hub.dispose();
});
