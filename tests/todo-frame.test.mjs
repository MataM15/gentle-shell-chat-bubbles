import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, theme } from './render-cache-harness.mjs';

const shared = load('compact-tool-cards');
const other = load('compact-other-tool-cards', { dependencies: {
  CardLine: shared.CardLine, RoundedFrame: shared.RoundedFrame, MarginBlock: shared.MarginBlock,
  TOOLS: ['bash', 'read', 'grep', 'find', 'ls', 'edit', 'write'],
  toneOf: shared.toneOf, isStaticExport: shared.isStaticExport,
}});
const component = (text) => ({ render: () => [text], invalidate() {} });
const native = { renderShell: 'self', renderCall: () => component('todo · update'), renderResult: () => component('task updated') };
const ctx = () => ({ state: {}, args: { action: 'update' }, expanded: false, executionStarted: true, invalidate: () => true });

test('todo uses a compact frame and preserves native expanded content', () => {
  const wrapped = other.wrapOtherRenderers('todo', native);
  const c = ctx();
  const call = wrapped.renderCall(c.args, theme, c);
  assert.ok(call instanceof shared.RoundedFrame);
  wrapped.renderResult({ content: [{type: 'text', text:'task updated'}] }, {expanded:false,isPartial:false}, theme, c);
  assert.match(call.render(80).join('\n'), /todo · update/);
  assert.match(call.render(80).join('\n'), /task updated/);
  c.expanded = true;
  const expanded = wrapped.renderCall(c.args, theme, c);
  wrapped.renderResult({ content: [{type:'text',text:'task updated'}] }, {expanded:true,isPartial:false}, theme, c);
  assert.ok(expanded instanceof shared.RoundedFrame);
  assert.match(expanded.render(80).join('\n'), /todo · update/);
  assert.match(expanded.render(80).join('\n'), /task updated/);
});

test('todo result without a prior call keeps the existing margin contract', () => {
  const wrapped = other.wrapOtherRenderers('todo', native);
  const result = wrapped.renderResult({content:[{type:'text',text:'task updated'}]}, {expanded:false,isPartial:false}, theme, ctx());
  assert.deepEqual(result.render(40), ['  task updated']);
});

test('framed todo shows call and result exactly once', () => {
  const wrapped = other.wrapOtherRenderers('todo', native);
  const c = ctx();
  const call = wrapped.renderCall(c.args, theme, c);
  const result = wrapped.renderResult({content:[{type:'text',text:'task updated'}]}, {expanded:false,isPartial:false}, theme, c);
  assert.equal([...call.render(40), ...result.render(40)].filter(line => line.includes('task updated')).length, 1);
});

test('todo result stays visible if the native call renderer throws', () => {
  const broken = { ...native, renderCall() { throw new Error('broken call'); }, renderResult: () => component('result still matters') };
  const wrapped = other.wrapOtherRenderers('todo', broken);
  const c = ctx();
  assert.throws(() => wrapped.renderCall(c.args, theme, c));
  const result = wrapped.renderResult({content:[{type:'text',text:'result still matters'}]}, {expanded:false,isPartial:false}, theme, c);
  assert.match(result.render(80).join('\n'), /result still matters/);
});

test('other self-shell renderers keep their existing margin-only path', () => {
  const wrapped = other.wrapOtherRenderers('interactive-control', native);
  assert.ok(wrapped.renderCall({}, theme, ctx()) instanceof shared.MarginBlock);
});
