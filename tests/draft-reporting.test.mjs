import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Exercise the actual handler and receipt validator; stub model output and external I/O only.
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = { result: null, writes: [], failWrite: false };
const slot = '__inboxDraftReportingTest';
globalThis[slot] = fixture;
const bundle = await build({
  absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm',
  stdin: { contents: "export { EmailAgent } from './workers/agent/index';", resolveDir: root },
  plugins: [{ name: 'controlled-boundaries', setup(b) {
    b.onResolve({ filter: /^(ai|@cloudflare\/ai-chat|workers-ai-provider)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
    b.onResolve({ filter: /(?:\.\.\/lib\/|\.\/)(email-helpers|tools|hierarchy|chat-model)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
      if (path === 'ai') return { contents: `export const generateText = async () => globalThis.${slot}.result; export const convertToModelMessages = async x => x; export const stepCountIs = () => () => true; export const streamText = () => { throw Error('Unexpected streaming'); };` };
      if (path === '@cloudflare/ai-chat') return { contents: 'export class AIChatAgent {}' };
      if (path === 'workers-ai-provider') return { contents: 'export const createWorkersAI = () => () => ({});' };
      if (path.endsWith('hierarchy')) return { contents: 'export const withOwnerMemory = async (_db, _id, prompt) => prompt;' };
      if (path.endsWith('chat-model')) return { contents: 'export const createChatModel = () => ({});' };
      if (path.endsWith('email-helpers')) return { contents: `
        export const getMailboxStub = () => ({
          getSettings: async () => ({}),
          getEmail: async () => ({ id:'email', sender:'sender@example.com', subject:'Question', body:null, thread_id:'thread' }),
          getThreadEmails: async () => [],
          createEmail: async (...args) => { if(globalThis.${slot}.failWrite) throw Error('Storage unavailable'); globalThis.${slot}.writes.push(args); }
        });
        export const replySubject = x => x; export const stripHtmlToText = x => x;
        export const textToHtml = x => x; export const escapeHtml = x => x;` };
      return { contents: ['ListEmails','GetEmail','GetThread','SearchEmails','DraftReply','DraftEmail','MarkEmailRead','MoveEmail','DiscardDraft'].map(n => `export const tool${n} = () => { throw Error('Unexpected tool execution'); };`).join('\n') };
    });
  } }],
});
const dir = await mkdtemp(join(tmpdir(), 'inbox-draft-reporting-'));
try {
  const output = join(dir, 'handler.mjs');
  await writeFile(output, bundle.outputFiles[0].text);
  const { EmailAgent } = await import(pathToFileURL(output).href);
  async function run(result, failWrite = false) {
    Object.assign(fixture, { result, failWrite, writes: [] });
    let persisted;
    const response = await EmailAgent.prototype.handleNewEmail.call({
      env: { AI: { run: async () => { throw Error('Unexpected model call'); } } }, messages: [],
      persistMessages: async messages => { persisted = messages; },
    }, { mailboxId:'owner@example.com', emailId:'email', sender:'sender@example.com', subject:'Question', threadId:'thread' });
    return { response, persisted, writes: fixture.writes };
  }
  const step = output => ({ toolCalls: [{ toolName:'draft_reply' }], toolResults: [{ toolName:'draft_reply', output }] });
  await test('failed draft tool does not save commentary or report success', async () => {
    const r = await run({ text:'I saved the draft successfully.', steps:[step({ error:'Storage failed' })] });
    assert.equal(r.response.status, 'draft_not_saved');
    assert.equal(r.writes.length, 0);
    assert.match(r.persisted.at(-1).content, /No draft was confirmed saved/);
    assert.doesNotMatch(r.persisted.at(-1).content, /I saved the draft successfully/);
  });
  await test('confirmed draft tool result reports saved, not sent, without duplicate write', async () => {
    const r = await run({ text:'Email sent!', steps:[step({ status:'draft_saved', draftId:'draft-1' })] });
    assert.equal(r.response.status, 'draft_generated');
    assert.equal(r.writes.length, 0);
    assert.match(r.persisted.at(-1).content, /Saved an email draft/);
    assert.match(r.persisted.at(-1).content, /No email was sent/);
  });
  await test('tool call without receipt and empty output cannot claim persistence', async () => {
    const r = await run({ text:'', steps:[{ toolCalls:[{ toolName:'draft_reply' }], toolResults:[] }] });
    assert.equal(r.response.status, 'draft_not_saved');
    assert.equal(r.writes.length, 0);
  });
  await test('inline draft reports success only after storage resolves', async () => {
    const r = await run({ text:'Thanks.', steps:[] });
    assert.equal(r.writes.length, 1);
    assert.equal(r.response.status, 'draft_generated');
    const failed = await run({ text:'Thanks.', steps:[] }, true);
    assert.equal(failed.response.status, 'error');
    assert.equal(failed.writes.length, 0);
    assert.equal(failed.persisted, undefined);
  });
} finally {
  delete globalThis[slot];
  await rm(dir, { recursive:true, force:true });
}
