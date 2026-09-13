import { renderMath, finishRenderMath } from 'obsidian';
import { renderOwnedMath } from '../src/rendering/mathLifecycle';

jest.mock('obsidian', () => ({renderMath: jest.fn(), finishRenderMath: jest.fn()}));
const render = jest.mocked(renderMath), finish = jest.mocked(finishRenderMath);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
	jest.resetAllMocks();
	render.mockImplementation(value => { const result = document.createElement('span'); result.textContent = value; return result; });
	finish.mockResolvedValue(undefined);
});

it('renders successful MathJax output in its current occurrence', async () => {
	const element = document.createElement('span'), controller = new AbortController();
	renderOwnedMath(element, 'x^2', controller.signal); await flush();
	expect(element.textContent).toBe('x^2');
});

it.each(['render', 'finish-sync', 'finish-async'])('shows a current %s failure', async phase => {
	const fail = () => { throw new Error('MathJax unavailable'); };
	if (phase === 'render') render.mockImplementation(fail);
	else if (phase === 'finish-sync') finish.mockImplementation(fail);
	else finish.mockRejectedValue(new Error('MathJax unavailable'));
	const element = document.createElement('span');
	renderOwnedMath(element, 'x', new AbortController().signal); await flush();
	expect(element.textContent).toBe('Unable to render math: MathJax unavailable');
	expect(element.classList.contains('numerals-error-message')).toBe(true);
});

it.each([false, true])('discards obsolete completion after replacement/unload, rejection=%s', async rejection => {
	let resolve!: () => void, reject!: (reason: Error) => void;
	finish.mockImplementationOnce(() => new Promise<void>((yes, no) => {resolve = yes; reject = no;}));
	const element = document.createElement('span'), lifetime = new AbortController();
	renderOwnedMath(element, 'old', lifetime.signal); lifetime.abort();
	renderOwnedMath(element, 'current', new AbortController().signal); await flush();
	if (rejection) reject(new Error('obsolete error')); else resolve();
	await flush(); expect(element.textContent).toBe('current');
});

it('does not invoke MathJax after an occurrence was retired', () => {
	const lifetime = new AbortController(); lifetime.abort();
	renderOwnedMath(document.createElement('span'), 'x', lifetime.signal);
	expect(render).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
});
