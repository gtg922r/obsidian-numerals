import { loadMathJax, renderMath, finishRenderMath } from 'obsidian';
import { renderOwnedMath } from '../src/rendering/mathLifecycle';

jest.mock('obsidian', () => ({loadMathJax: jest.fn(), renderMath: jest.fn(), finishRenderMath: jest.fn()}));
const load = jest.mocked(loadMathJax), render = jest.mocked(renderMath), finish = jest.mocked(finishRenderMath);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
	jest.resetAllMocks();
	load.mockResolvedValue(undefined);
	render.mockImplementation(value => { const result = document.createElement('span'); result.textContent = value; return result; });
	finish.mockResolvedValue(undefined);
});

it('renders successful MathJax output in its current occurrence', async () => {
	const element = document.createElement('span'), controller = new AbortController();
	renderOwnedMath(element, 'x^2', controller.signal); await flush();
	expect(element.textContent).toBe('x^2');
});

it('waits for cold-start readiness before invoking MathJax or appending output', async () => {
	let ready!: () => void;
	load.mockReturnValueOnce(new Promise<void>(resolve => { ready = resolve; }));
	const element = document.createElement('span');
	renderOwnedMath(element, 'x^2', new AbortController().signal, false); await flush();
	expect(load).toHaveBeenCalledTimes(1);
	expect(render).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
	expect(element.childNodes).toHaveLength(0);
	ready(); await flush();
	expect(render).toHaveBeenCalledWith('x^2', false);
	expect(element.textContent).toBe('x^2');
});

it.each(['load-sync', 'load-async', 'render', 'finish-sync', 'finish-async'])('shows a current %s failure', async phase => {
	const fail = () => { throw new Error('MathJax unavailable'); };
	if (phase === 'load-sync') load.mockImplementation(fail);
	else if (phase === 'load-async') load.mockRejectedValue(new Error('MathJax unavailable'));
	else if (phase === 'render') render.mockImplementation(fail);
	else if (phase === 'finish-sync') finish.mockImplementation(fail);
	else finish.mockRejectedValue(new Error('MathJax unavailable'));
	const element = document.createElement('span');
	renderOwnedMath(element, 'x', new AbortController().signal); await flush();
	expect(element.textContent).toBe('Unable to render math: MathJax unavailable');
	expect(element.classList.contains('numerals-error-message')).toBe(true);
	if (phase.startsWith('load')) { expect(render).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled(); }
});

it.each([false, true])('does no retired rendering or DOM work after readiness settles, rejection=%s', async rejection => {
	let resolve!: () => void, reject!: (reason: Error) => void;
	load.mockReturnValueOnce(new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
	const element = document.createElement('span'), lifetime = new AbortController();
	renderOwnedMath(element, 'old', lifetime.signal); await flush(); lifetime.abort();
	renderOwnedMath(element, 'current', new AbortController().signal); await flush();
	if (rejection) reject(new Error('obsolete readiness error')); else resolve();
	await flush();
	expect(render).toHaveBeenCalledTimes(1); expect(render).toHaveBeenCalledWith('current', true);
	expect(finish).toHaveBeenCalledTimes(1); expect(element.textContent).toBe('current');
	expect(element.classList.contains('numerals-error-message')).toBe(false);
});

it('allows a later occurrence to retry after a readiness failure', async () => {
	load.mockRejectedValueOnce(new Error('startup failed'));
	const failed = document.createElement('span'), current = document.createElement('span');
	renderOwnedMath(failed, 'old', new AbortController().signal); await flush();
	expect(failed.textContent).toBe('Unable to render math: startup failed');
	renderOwnedMath(current, 'current', new AbortController().signal); await flush();
	expect(load).toHaveBeenCalledTimes(2);
	expect(render).toHaveBeenCalledTimes(1); expect(current.textContent).toBe('current');
});

it.each([false, true])('discards obsolete completion after replacement/unload, rejection=%s', async rejection => {
	let resolve!: () => void, reject!: (reason: Error) => void;
	finish.mockImplementationOnce(() => new Promise<void>((yes, no) => {resolve = yes; reject = no;}));
	const element = document.createElement('span'), lifetime = new AbortController();
	renderOwnedMath(element, 'old', lifetime.signal); await flush(); lifetime.abort();
	renderOwnedMath(element, 'current', new AbortController().signal); await flush();
	if (rejection) reject(new Error('obsolete error')); else resolve();
	await flush(); expect(element.textContent).toBe('current');
});

it('does not invoke MathJax after an occurrence was retired', () => {
	const lifetime = new AbortController(); lifetime.abort();
	renderOwnedMath(document.createElement('span'), 'x', lifetime.signal);
	expect(load).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
});
