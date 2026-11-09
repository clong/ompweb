import { test, mock } from 'bun:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { validWorkspaceResult } from './workspace-results.ts';

test('terminal capture selects only the registered session and rejects unknown, ambiguous and oversized screens', async () => {
  const realReader = { ...await import('../session-reader.ts') };
  const realChild = { ...await import('node:child_process') };
  let listing = '%1\tother\t80\t24\t0\n%2\twanted\t120\t40\t0\n';
  const calls = [];
  const fake = () => {};
  fake[promisify.custom] = async (file, args) => {
    calls.push([file, args]);
    return {stdout:args.includes('list-panes') ? listing : '\u001b[38;2;112;185;190mactual screen',stderr:''};
  };
  mock.module('node:child_process', () => ({...realChild, execFile: fake}));
  mock.module('../session-reader.ts', () => ({...realReader, resolveSessionPath:async id => id === 'wanted' ? '/session.jsonl' : null}));
  try {
    const {terminalScreen} = await import('./terminal-screen.ts?capture-test');
    const result = await terminalScreen('wanted');
    assert.equal(result.columns,120);assert.match(result.screen,/actual screen/);
    assert.equal(calls.at(-1)[1].at(-1),'%2');
    await assert.rejects(() => terminalScreen('other'),e=>e.status===404);
    await assert.rejects(() => terminalScreen('../wanted'),e=>e.status===400);
    listing += '%3\twanted\t120\t40\t0\n';
    await assert.rejects(() => terminalScreen('wanted'),e=>e.code==='terminal_unavailable');
    listing = '%2\twanted\t100000\t40\t0\n';
    await assert.rejects(() => terminalScreen('wanted'),e=>e.code==='terminal_size');
    assert.equal(validWorkspaceResult('terminalScreen',{ok:true,value:result}),true);
    assert.equal(validWorkspaceResult('terminalScreen',{ok:true,value:{...result,rows:100000}}),false);
    assert.equal(validWorkspaceResult('terminalScreen',{ok:true,value:{...result,screen:'x'.repeat(2097153)}}),false);
  } finally {
    mock.module('node:child_process',()=>realChild);mock.module('../session-reader.ts',()=>realReader);
  }
});
