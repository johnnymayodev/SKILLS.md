import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { buildReport, buildInspectionReport, readSession, renderReport } from './render.mjs';

const item = payload => ({ type: 'response_item', payload });
const usage = (input, output, reasoning) => ({ input_tokens: input, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output });
function fixture() {
  const first = usage(2000, 80, 20), last = usage(4000, 100, 40);
  return [
    { type: 'session_meta', payload: { cwd: '/fixture' } },
    item({ type: 'additional_tools', tools: [{ name: 'functions', tools: [{ name: 'exec', description: 'PRIVATE_SCHEMA_BODY', parameters: {} }] }] }),
    item({ type: 'message', role: 'developer', content: [{ text: 'PRIVATE_DEVELOPER_BODY\n- sample-skill: A sample. (file: /skills/sample-skill/SKILL.md)' }] }),
    item({ type: 'message', role: 'user', content: [{ text: '# AGENTS.md\nPRIVATE_USER_RULES' }] }),
    item({ type: 'message', role: 'assistant', content: [{ text: 'Working.' }] }),
    item({ type: 'custom_tool_call', name: 'exec', call_id: 'one', input: 'cat /skills/sample-skill/SKILL.md' }),
    { type: 'token_usage_record', timestamp: '2026-01-01T00:00:01Z', payload: { usage: first } },
    item({ type: 'custom_tool_call_output', call_id: 'one', output: [{ type: 'input_text', text: JSON.stringify({ output: '---\nname: sample-skill\n---\nPRIVATE_SKILL_BODY' }) }, { type: 'input_text', text: JSON.stringify({ names: ['safe_tool'] }) }, { type: 'input_image', image_url: 'PRIVATE_IMAGE_PAYLOAD' }] }),
    { type: 'event_msg', timestamp: '2026-01-01T00:00:02Z', payload: { type: 'token_count', info: { last_token_usage: first, model_context_window: 10000 } } },
    item({ type: 'reasoning', encrypted_content: 'PRIVATE_REASONING_PAYLOAD' }),
    item({ type: 'message', role: 'assistant', content: [{ text: 'Done.' }] }),
    { type: 'token_usage_record', timestamp: '2026-01-01T00:00:03Z', payload: { usage: last } },
    { type: 'event_msg', timestamp: '2026-01-01T00:00:04Z', payload: { type: 'token_count', info: { last_token_usage: last, model_context_window: 10000 } } },
  ];
}
const template = readFileSync(new URL('../assets/context-window.html', import.meta.url), 'utf8');
const total = groups => groups.reduce((sum, group) => sum + group.tokens, 0);

function inspectionFixture() {
  return [...fixture(), { ...item({ type: 'message', id: 'inspection-request', role: 'user', content: [{ type: 'input_text', text: 'Show the context window.' }], internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] } }), timestamp: '2026-01-01T00:00:05Z' }];
}

test('pre-inspection reports exclude the inspection request and all diagnostic work even after newer usage arrives', () => {
  const events = inspectionFixture();
  events.push(item({ type: 'custom_tool_call', name: 'exec', call_id: 'diagnostic', input: 'cat /inspection/diagnostic/SKILL.md' }));
  const diagnostic = usage(6000, 100, 10);
  events.push({ type: 'token_usage_record', timestamp: '2026-01-01T00:00:06Z', payload: { usage: diagnostic } });
  events.push(item({ type: 'custom_tool_call_output', call_id: 'diagnostic', output: [{ text: JSON.stringify({ output: '---\nname: diagnostic-skill\n---\nDiagnostic work.' }) }] }));
  events.push({ type: 'event_msg', timestamp: '2026-01-01T00:00:07Z', payload: { type: 'token_count', info: { last_token_usage: diagnostic, model_context_window: 10000 } } });
  const report = buildInspectionReport(events);
  assert.equal(report.telemetry.latest.total, 4100);
  assert.equal(report.telemetry.scope, 'before-request');
  assert.equal(report.telemetry.beforeRequest.id, 'inspection-request');
  assert.ok(!report.inventory.some(item => item.name === 'diagnostic-skill'));
  assert.equal(total(report.attribution.groups), 4100);
  events.push({ ...item({ type: 'message', id: 'follow-up', role: 'user', content: [{ text: 'Change the colors.' }] }), timestamp: '2026-01-01T00:00:08Z' });
  assert.equal(buildInspectionReport(events, 'inspection-request').telemetry.latest.total, 4100);
});

test('the first inspection without earlier usage is reported unavailable rather than using inspection-time telemetry', () => {
  const events = inspectionFixture();
  const request = events.pop();
  events.splice(4, 0, request);
  assert.throws(() => buildInspectionReport(events), /No recorded context usage before/);
  assert.throws(() => buildInspectionReport(inspectionFixture(), 'missing-request'), /Inspection request not found/);
});

test('measured totals reconcile and reports do not embed raw session contents', () => {
  const report = buildReport(fixture());
  assert.equal(total(report.attribution.groups), 4100);
  assert.equal(total(report.attribution.groups.filter(group => group.id !== 'response')), 4000);
  assert.equal(total(report.attribution.groups.filter(group => group.id === 'response')), 100);
  assert.equal(report.inventory.find(item => item.name === 'sample-skill').status, 'Read');
  assert.equal(report.inventory.find(item => item.name === 'safe_tool').status, 'Registry');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  assert.equal(report.attribution.groups.find(group => group.id === 'response').items.find(item => item.name.includes('reasoning')).tokens, 40);
});

test('earlier snapshot excludes results returned after its request', () => {
  const report = buildReport(fixture(), '2026-01-01T00:00:02Z');
  assert.equal(report.telemetry.latest.total, 2080);
  assert.equal(total(report.attribution.groups), 2080);
  assert.equal(report.inventory.find(item => item.name === 'sample-skill').status, 'Catalog');
  assert.ok(!report.inventory.some(item => item.name === 'safe_tool'));
});

test('agent instructions have their own attribution group and inventory type, separate from skills', () => {
  const report = buildReport(fixture());
  const agents = report.attribution.groups.find(group => group.id === 'agents');
  const skills = report.attribution.groups.find(group => group.id === 'skills');
  assert.ok(agents?.items.some(item => item.name === 'AGENTS.md'));
  assert.ok(skills?.items.some(item => item.name === 'sample-skill/SKILL.md'));
  assert.ok(skills.items.some(item => item.name === 'sample-skill · catalog entry'));
  assert.equal(report.inventory.find(item => item.name === 'AGENTS.md').type, 'Agent instructions');
  assert.equal(report.inventory.find(item => item.name === 'sample-skill').type, 'Skills');
  assert.equal(total(report.attribution.groups), 4100);
});

test('instruction-file reads take precedence over skill-like frontmatter and failed reads are not counted as loaded', () => {
  for (const name of ['AGENT.md', 'AGENTS.override.md', 'CLAUDE.md', 'GEMINI.md', 'copilot-instructions.md']) {
    const events = fixture();
    events[5].payload.input = `cat /project/${name}`;
    events[7].payload.output = [{ type: 'input_text', text: JSON.stringify({ exit_code: 0, output: '---\nname: not-a-skill\n---\nPRIVATE_AGENT_RULES' }) }];
    const report = buildReport(events);
    assert.equal(report.inventory.find(item => item.name === `/project/${name}`).type, 'Agent instructions');
    assert.equal(report.inventory.find(item => item.name === `/project/${name}`).status, 'Read');
    assert.ok(!report.inventory.some(item => item.name === 'not-a-skill'));
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_AGENT_RULES/);
    assert.equal(total(report.attribution.groups), 4100);
    events[7].payload.output = [{ type: 'input_text', text: JSON.stringify({ exit_code: 1, output: 'No such file' }) }];
    const failed = buildReport(events);
    assert.ok(!failed.inventory.some(item => item.name === `/project/${name}` && item.status === 'Read'));
  }
});

test('source paths are preserved for skill catalogs, skill reads, and instruction reads without guessing inline locations', () => {
  const report = buildReport(fixture());
  const skill = report.inventory.find(item => item.name === 'sample-skill');
  assert.deepEqual(skill.paths, ['/skills/sample-skill/SKILL.md']);
  assert.deepEqual(report.attribution.groups.find(group => group.id === 'skills').items.find(item => item.name === 'sample-skill/SKILL.md').paths, skill.paths);
  assert.deepEqual(report.inventory.find(item => item.name === 'AGENTS.md').paths, []);
  const events = fixture();
  events[5].payload.input = 'cat "/project/my repo/AGENTS.md"';
  events[7].payload.output = [{ type: 'input_text', text: JSON.stringify({ output: '# Project rules\nPRIVATE_AGENT_BODY' }) }];
  const agent = buildReport(events).inventory.find(item => item.status === 'Read' && item.type === 'Agent instructions');
  assert.deepEqual(agent.paths, ['/project/my repo/AGENTS.md']);
});

test('catalog aliases and batched skill reads resolve to the matching recorded path', () => {
  const events = fixture();
  events[2].payload.content[0].text = '- `r0` = `/skills`\n- sample-skill: Sample. (file: r0/sample-skill/SKILL.md)';
  events[5].payload.input = 'cat /skills/other/SKILL.md\ncat /skills/sample-skill/SKILL.md';
  const report = buildReport(events);
  assert.deepEqual(report.inventory.find(item => item.name === 'sample-skill').paths, ['/skills/sample-skill/SKILL.md']);
});

test('conversation attachments retain explicit paths and filenames without embedding attachment payloads', () => {
  const events = fixture();
  events[3].payload.content.push(
    { type: 'input_file', filename: 'notes.md', file_path: '/uploads/notes.md', file_data: 'PRIVATE_ATTACHMENT_DATA' },
    { type: 'input_file', filename: 'remote.pdf', file_id: 'PRIVATE_FILE_ID' },
    { type: 'input_text', text: 'Metadata attachment.' },
  );
  events[3].payload.attachments = [{ filename: 'table.csv', local_path: '/uploads/table.csv', data: 'PRIVATE_ATTACHMENT_DATA' }];
  events[3].payload.internal_chat_message_metadata_passthrough = { content_item_kinds: ['agents_md.instructions', 'user.file', 'user.file', 'attachment.file'], content_item_metadata: [{ provenance: { file_path: '/project/AGENTS.md' } }, {}, {}, { provenance: { path: '/uploads/report.txt', filename: 'report.txt' } }] };
  const report = buildReport(events);
  const files = report.inventory.filter(item => item.type === 'Files');
  assert.deepEqual(files.find(item => item.name === 'notes.md').paths, ['/uploads/notes.md']);
  assert.deepEqual(files.find(item => item.name === 'remote.pdf').paths, []);
  assert.deepEqual(files.find(item => item.name === 'table.csv').paths, ['/uploads/table.csv']);
  assert.deepEqual(files.find(item => item.name === 'report.txt').paths, ['/uploads/report.txt']);
  assert.deepEqual(report.inventory.find(item => item.name === 'AGENTS.md').paths, ['/project/AGENTS.md']);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  assert.equal(total(report.attribution.groups), 4100);
});

test('compaction and oversized estimates preserve totals without invented source shares', () => {
  for (const mutate of [
    events => events.splice(9, 0, { type: 'compacted', payload: {} }),
    events => { events[3].payload.content[0].text = 'x'.repeat(40000); },
  ]) {
    const events = fixture(); mutate(events);
    const report = buildReport(events);
    assert.equal(total(report.attribution.groups), 4100);
    assert.equal(report.attribution.groups.find(group => group.id === 'unknown').tokens, 4000);
    assert.ok(!report.attribution.groups.some(group => group.kind === 'Estimated'));
  }
});

test('missing capacity, malformed accounting, and malformed log interiors fail explicitly', () => {
  const events = fixture(); delete events.at(-1).payload.info.model_context_window;
  assert.throws(() => buildReport(events), /capacity/);
  events.at(-2).payload.usage.output_tokens = 1;
  assert.throws(() => buildReport(events), /accounting/);
  assert.throws(() => buildReport(fixture(), 'invalid'), /timestamp/);
  assert.throws(() => readSession('{}\nnot-json\n{}'), /line 2/);
  assert.deepEqual(readSession('{}\n{"unfinished"'), [{}]);
});

test('token_count-only logs can still produce a measured report', () => {
  const report = buildReport(fixture().filter(event => event.type !== 'token_usage_record'));
  assert.equal(report.telemetry.latest.total, 4100);
  assert.equal(total(report.attribution.groups), 4100);
});

test('an in-flight request without a flushed capacity event does not replace the last complete snapshot', () => {
  const events = fixture();
  events.push({ type: 'token_usage_record', timestamp: '2026-01-01T00:00:05Z', payload: { usage: usage(5000, 50, 10) } });
  const report = buildReport(events);
  assert.equal(report.telemetry.latest.total, 4100);
  assert.equal(report.telemetry.latest.timestamp, '2026-01-01T00:00:04Z');
});

test('rendered explorer escapes source labels and supports selection, percentages, filters, and toggles', () => {
  const report = buildInspectionReport(inspectionFixture());
  report.inventory.push({ name: '</script><img src=x>', type: 'Tools', group: 'Test', status: 'Registry', description: '$&', detail: 'Safe label' });
  const html = renderReport(report, template);
  assert.doesNotMatch(html, /__CONTEXT_(?:INVENTORY|TELEMETRY|ATTRIBUTION)__/);
  assert.doesNotMatch(html, /<\/script><img/);
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', style: {}, events: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener(k, fn) { this.events[k] = fn; } });
    return nodes.get(id);
  };
  const context = vm.createContext({ document: { getElementById: get, querySelectorAll: () => [] } });
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]).runInContext(context);
  const run = code => vm.runInContext(code, context);
  assert.equal(get('usagePercent').textContent, '41.0%');
  assert.match(get('usageTime').textContent, /Before inspection request/);
  assert.match(get('usageExplanation').textContent, /inspection request and all later diagnostic work are excluded/);
  assert.equal(get('skillCount').textContent, 1);
  run('changeType("Skills")');
  assert.match(get('list').innerHTML, /\/skills\/sample-skill\/SKILL.md/);
  run('selectGroup("skills")');
  assert.match(get('sourceList').innerHTML, /\/skills\/sample-skill\/SKILL.md/);
  assert.equal(get('agentCount').textContent, 1);
  run('changeType("Agent instructions")');
  assert.equal(run('matching().length'), 1);
  assert.match(get('list').innerHTML, /AGENTS.md/);
  assert.match(get('list').innerHTML, /Path not recorded/);
  run('changeType("All")');
  assert.match(get('allocationNote').textContent, /10,000-token/);
  run('selectGroup("response")');
  assert.match(get('attributionHeading').innerHTML, /1.00% of window/);
  get('usageMode').events.click();
  assert.equal(get('usagePercent').textContent, '40.0%');
  assert.equal(run('allocationGroups().some(group=>group.id==="response")'), false);
  assert.equal(run('allocationGroups().reduce((n,g)=>n+g.tokens,0)'), 4000);
  get('search').events.input({ target: { value: 'SAMPLE-SKILL' } });
  assert.equal(run('matching().length'), 1);
  get('reset').events.click();
  get('search').events.input({ target: { value: '/skills/sample-skill/' } });
  assert.equal(run('matching().length'), 1);
});

test('CLI rejects a different workspace and writes a portable report for a matching session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'context-window-test-'));
  try {
    const session = join(dir, 'session.jsonl'), output = join(dir, 'report.html');
    writeFileSync(session, inspectionFixture().map(event => JSON.stringify(event)).join('\n'));
    const script = new URL('./render.mjs', import.meta.url);
    const wrong = spawnSync(process.execPath, [script.pathname, '--session', session, '--out', output], { encoding: 'utf8' });
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /workspace mismatch/);
    assert.equal(existsSync(output), false);
    const right = spawnSync(process.execPath, [script.pathname, '--session', session, '--out', output, '--cwd', '/fixture'], { encoding: 'utf8' });
    assert.equal(right.status, 0, right.stderr);
    assert.equal(JSON.parse(right.stdout).used, 4100);
    assert.doesNotMatch(readFileSync(output, 'utf8'), /PRIVATE_/);
    const saved = readFileSync(output, 'utf8');
    const missing = spawnSync(process.execPath, [script.pathname, '--session', session, '--out', output, '--cwd', '/fixture', '--before-message', 'missing-request'], { encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    assert.equal(readFileSync(output, 'utf8'), saved);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
