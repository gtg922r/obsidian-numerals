// FIXTURE_CONFIG and CONTRACTS are prepended by run.mjs; no product plugin is loaded.
const {Plugin, Component, MarkdownRenderer, FileSystemAdapter, MarkdownView, editorInfoField, editorLivePreviewField, apiVersion} = require('obsidian');
const {ViewPlugin} = require('@codemirror/view');
const {syntaxTree, ensureSyntaxTree} = require('@codemirror/language');
const fs = require('node:fs');
const path = require('node:path');
const {guard, sourceCheck, catalogCheck, check, hash, IDENTITY, failure} = CONTRACTS;
const LANGUAGES = ['math','Math','math-plain','math-tex','math-TeX','math-highlight'];
module.exports = class FixtureRecorder extends Plugin {
  guard() {
    check(!this.stopped && this.app.vault.adapter instanceof FileSystemAdapter, 'recorder unavailable');
    guard(this.app.vault.adapter.getBasePath(), FIXTURE_CONFIG);
  }
  sleep(ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.timers.delete(timer); resolve(); }, ms);
      this.timers.set(timer, reject);
    });
  }
  observe(callback) { try { callback(); } catch (error) { this.asyncError ??= error; } }
  async deadline(operation, timeout = 5000) {
    let timer;
    try {
      await Promise.race([operation(), new Promise((_,reject) => {
        timer = setTimeout(() => { this.timers.delete(timer); reject(Error('fixture settling deadline')); },timeout);
        this.timers.set(timer,reject);
      })]);
    } finally { clearTimeout(timer); this.timers.delete(timer); }
  }
  section(ctx, el) {
    const section = ctx.getSectionInfo(el);
    return section ? {text:section.text, lineStart:section.lineStart, lineEnd:section.lineEnd} : null;
  }
  push(event) {
    this.guard();
    if (!this.current) return;
    check(this.current.events.length < 2000, 'callback limit');
    this.current.events.push({sequence:++this.sequence, surface:this.current.mode, ...event});
    this.lastEventAt = Date.now();
  }
  context(ctx, el) {
    if (ctx.docId != null && !this.documents.has(ctx.docId)) this.documents.set(ctx.docId,`context-${this.documents.size + 1}`);
    return {sourcePath:ctx.sourcePath, docId:ctx.docId == null ? null : this.documents.get(ctx.docId), section:this.section(ctx, el)};
  }
  captureEditor(view) {
    this.guard();
    const file = view.state.field(editorInfoField, false)?.file;
    if (!this.current || this.current.mode !== 'live-preview' || file?.path !== this.current.path) return;
    const complete = ensureSyntaxTree(view.state, view.state.doc.length, 100);
    const tree = complete || syntaxTree(view.state), nodes = [];
    tree.iterate({enter(node) { nodes.push({name:node.name, from:node.from, to:node.to, text:view.state.doc.sliceString(node.from,node.to)}); }});
    this.push({kind:'editor-tree', sourcePath:file.path, document:view.state.doc.toString(), livePreview:view.state.field(editorLivePreviewField,false) ?? null, treeComplete:!!complete, nodes});
  }
  async onload() {
    this.stopped = false; this.timers = new Map(); this.editorViews = new Set();
    this.sequence = 0; this.current = null; this.busy = false; this.documents = new Map();
    this.guard();
    this.catalog = JSON.parse(fs.readFileSync(path.join(FIXTURE_CONFIG.expectedRoot, '.fixture-sources.json'), 'utf8'));
    catalogCheck(this.catalog);
    this.evidence = {schema:1, fixtureIdentity:IDENTITY, status:'ready', host:{apiVersion, platform:process.platform, electron:process.versions.electron, chromium:process.versions.chrome}, results:[], controls:[]};
    this.registerMarkdownPostProcessor((el, ctx) => this.observe(() => {
      if (!this.current) return;
      this.push({kind:'section', ...this.context(ctx,el)});
      const codes = [...(el.matches('code') ? [el] : []), ...el.querySelectorAll('code')];
      for (const code of codes) this.push({kind:code.closest('pre') ? 'raw-block-code' : 'inline-code', text:code.textContent, ...this.context(ctx,code)});
    }), -1000);
    for (const language of LANGUAGES) this.registerMarkdownCodeBlockProcessor(language, (source, el, ctx) => this.observe(() => {
      if (this.current) this.push({kind:'block-handler', language, source, ...this.context(ctx,el)});
      el.createEl('pre').createEl('code', {text:source});
    }), 100);
    const owner = this;
    this.registerEditorExtension(ViewPlugin.fromClass(class {
      constructor(view) { this.view = view; owner.editorViews.add(view); owner.observe(() => owner.captureEditor(view)); }
      update(update) { if (update.docChanged || update.viewportChanged || update.transactions.length) owner.observe(() => owner.captureEditor(update.view)); }
      destroy() { owner.editorViews.delete(this.view); }
    }));
    this.register(() => {
      this.stopped = true;
      for (const [timer,reject] of this.timers) { clearTimeout(timer); reject(Error('recorder unloaded')); }
      this.timers.clear(); this.editorViews.clear();
      delete window.__numeralsFixtureRecorder;
    });
    this.app.workspace.onLayoutReady(() => {
      if (!this.stopped) { this.guard(); window.__numeralsFixtureRecorder = this; }
    });
  }
  async one(fixture, mode) {
    let result;
    await this.deadline(async () => { result = await this.captureOne(fixture,mode); });
    return result;
  }
  async captureOne(fixture, mode) {
    this.guard(); sourceCheck(FIXTURE_CONFIG.expectedRoot, fixture);
    const leaf = this.app.workspace.getLeaf(false);
    // Clear the prior view before attributing callbacks to the next occurrence.
    this.current = null;
    await leaf.setViewState({type:'empty'});
    await this.sleep(100);
    const result = {id:fixture.id, path:fixture.path, mode, sourceSha256:fixture.sha256, events:[], opened:false, settled:false};
    this.current = result; this.lastEventAt = Date.now();
    const started = Date.now();
    await leaf.setViewState({type:'markdown', active:true, state:{file:fixture.path, mode:mode === 'reading' ? 'preview' : 'source'}});
    this.guard();
    check(leaf.view instanceof MarkdownView && leaf.view.file?.path === fixture.path, 'fixture view identity');
    result.actualMode = leaf.view.getMode(); result.opened = true;
    this.push({kind:'view-open', sourcePath:fixture.path});
    // A real view must remain quiet for 600 ms, after at least 800 ms of rendering.
    // The controller imposes a separate deadline even if Obsidian stops responding.
    for (;;) {
      await this.sleep(100); this.guard();
      if (this.asyncError) throw this.asyncError;
      check(Date.now() - started < 5000, 'fixture settling deadline');
      check(leaf.view.file?.path === fixture.path, 'fixture view changed');
      if (Date.now() - started >= 800 && Date.now() - this.lastEventAt >= 600) break;
    }
    if (mode === 'live-preview') {
      for (const view of this.editorViews) this.captureEditor(view);
      check(result.events.some(e => e.kind === 'editor-tree' && e.treeComplete && e.livePreview === true), 'Live Preview not ready');
    }
    if (mode === 'reading' && !result.events.some(e => ['block-handler','inline-code'].includes(e.kind))) {
      const witness = {completed:false,sourceSha256:fixture.sha256,events:[],mode,path:fixture.path};
      const component = new Component(); component.load();
      const el = document.createElement('div'); this.current = witness;
      try {
        await MarkdownRenderer.render(this.app,fixture.text,el,fixture.path,component);
        if (this.asyncError) throw this.asyncError;
        witness.completed = true;
        result.emptyWitness = witness;
      } finally { component.unload(); el.remove(); this.current = result; }
    }
    if (this.asyncError) throw this.asyncError;
    this.guard(); sourceCheck(FIXTURE_CONFIG.expectedRoot, fixture);
    result.settled = true; this.current = null;
    return result;
  }
  async capture(ids) {
    this.guard(); check(!this.busy, 'capture already running'); this.busy = true;
    this.evidence.status = 'running';
    try {
      const control = {id:'control', path:'control.md', text:'```math\n314159\n```\n\n`#:271828`', sha256:hash('```math\n314159\n```\n\n`#:271828`')};
      for (const mode of ['reading', 'live-preview']) {
        for (const position of ['before','after']) {
          if (position === 'after') {
            for (const id of ids) {
              const fixture = this.catalog.cases.find(c => c.id === id);
              check(fixture, 'unknown fixture');
              this.evidence.results.push(await this.one(fixture,mode));
              this.export();
            }
          }
          const result = await this.one(control,mode);
          const ok = mode === 'reading'
            ? result.events.some(e => e.kind === 'block-handler' && e.source.trim() === '314159') && result.events.some(e => e.kind === 'inline-code' && e.text === '#:271828')
            : result.events.some(e => e.kind === 'editor-tree' && e.treeComplete && e.livePreview === true && e.document === control.text);
          check(ok, 'positive control failed');
          this.evidence.controls.push({mode,position,ok,events:result.events});
        }
      }
      this.evidence.status = 'complete';
    } catch (error) { this.evidence.status = 'failed'; this.evidence.failure = failure(error,'capture',this.current); }
    finally { this.current = null; this.busy = false; this.export(); }
    return {status:this.evidence.status, count:this.evidence.results.length};
  }
  export() {
    this.guard();
    const output = path.join(FIXTURE_CONFIG.expectedRoot, '.fixture-capture.json');
    fs.writeFileSync(output + '.tmp', JSON.stringify(this.evidence));
    fs.renameSync(output + '.tmp', output);
  }
};
