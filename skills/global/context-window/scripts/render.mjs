import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const GROUPS = [
  ['tools', 'Tools & schemas', 'var(--chart-1)'],
  ['agents', 'Agent instructions', 'var(--chart-4)'],
  ['skills', 'Skills', 'var(--chart-2)'], ['files', 'Other files', 'var(--chart-6)'],
  ['docs', 'Documentation', 'var(--chart-3)'],
  ['conversation', 'Conversation', 'color-mix(in srgb, var(--chart-1), var(--foreground) 35%)'],
  ['unknown', 'Unattributed / setup', 'var(--chart-5)'],
  ['response', 'Selected response', 'color-mix(in srgb, var(--chart-6), var(--foreground) 30%)'],
];
const INSTRUCTION_FILE = /^(?:AGENTS?(?:\.override)?\.md|CLAUDE(?:\.local)?\.md|GEMINI\.md|copilot-instructions\.md|\.cursorrules)$/i;
function instructionHeading(text) {
  const match = text.match(/^#{1,6}\s+(?:`([^`]+)`|(\S+))/);
  const heading = match && (match[1] || match[2]);
  return heading && INSTRUCTION_FILE.test(basename(heading)) ? heading : null;
}
const uniquePaths = paths => [...new Set(paths.filter(path => typeof path === 'string' && path && !/[\r\n]/.test(path) && !/^(?:data|https?):/i.test(path)))];
function metadataPaths(...objects) {
  return uniquePaths(objects.flatMap(object => object && typeof object === 'object' ? ['path', 'file_path', 'local_path'].map(key => object[key]) : []));
}
function readPaths(code) {
  const paths = [];
  for (const regex of [
    /\bcat\s+(?:"([^"]+)"|'([^']+)'|([^\s"'\\;$]+))/g,
    /\bsed\s+-n\s+(?:"[^"]*"|'[^']*'|\S+)\s+(?:"([^"]+)"|'([^']+)'|([^\s"'\\;$]+))/g,
    /\b(?:readFileSync|readFile|Bun\.file)\(\s*(?:"([^"]+)"|'([^']+)')/g,
  ]) for (const match of code.matchAll(regex)) {
    const path = match[1] || match[2] || match[3];
    if (path && !/[$`]/.test(path)) paths.push(path);
  }
  return uniquePaths(paths);
}
const estimate = text => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
const generated = item => item?.type === 'reasoning' || /tool_call$/.test(item?.type || '') || (item?.type === 'message' && item.role === 'assistant');
const parse = text => { try { return JSON.parse(text); } catch { return null; } };

export function readSession(text) {
  const lines = text.trimEnd().split('\n');
  return lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    const event = parse(line);
    if (event) return [event];
    if (index === lines.length - 1) return []; // An active log may end in an unfinished write.
    throw new Error(`Invalid session JSON at line ${index + 1}`);
  });
}

function measurements(events) {
  const records = events.flatMap((event, index) => {
    if (event.type !== 'token_usage_record' || !event.payload?.usage) return [];
    const usage = event.payload.usage;
    const nextRecord = events.findIndex((item, i) => i > index && item.type === 'token_usage_record');
    const paired = events.slice(index + 1, nextRecord < 0 ? undefined : nextRecord).find(item =>
      item.type === 'event_msg' && item.payload?.type === 'token_count' &&
      item.payload.info?.last_token_usage?.input_tokens === usage.input_tokens &&
      item.payload.info?.last_token_usage?.total_tokens === usage.total_tokens);
    // The newest request may still be running its tool, before token_count is flushed.
    return paired ? [{ index, timestamp: paired.timestamp, usage, capacity: paired.payload.info.model_context_window }] : [];
  });
  if (records.length) return records;
  return events.flatMap((event, index) => {
    const info = event.type === 'event_msg' && event.payload?.type === 'token_count' ? event.payload.info : null;
    return info?.last_token_usage ? [{ index, timestamp: event.timestamp, usage: info.last_token_usage, capacity: info.model_context_window }] : [];
  });
}

function classify(raw, code) {
  const object = parse(raw);
  const command = object?.result?.value?.output ?? (typeof object?.output === 'string' ? object.output : null);
  const body = command || raw;
  const paths = readPaths(code);
  const file = paths.length === 1 ? paths[0] : null;
  const exitCode = object?.result?.value?.exit_code ?? object?.exit_code;
  const agent = command && (exitCode === undefined || exitCode === 0) && (instructionHeading(command) || (file && INSTRUCTION_FILE.test(basename(file)) ? file : null));
  if (agent) return ['agents', agent, 'Agent-instruction file text returned to the model, including its wrapper.', null, agent, file ? [file] : agent.includes('/') ? [agent] : []];
  const skill = command?.match(/^---[\s\S]*?\nname:\s*["']?([^\n"']+)/)?.[1]?.trim();
  if (skill) {
    const matching = paths.filter(path => basename(dirname(path)) === skill.split(':').at(-1) && basename(path) === 'SKILL.md');
    return ['skills', `${skill}/SKILL.md`, 'Full skill-file read, including its returned wrapper.', skill, null, matching.length ? matching : file ? [file] : []];
  }
  if (/<!doctype html>/i.test(body)) return ['files', 'HTML source readback (possibly mixed)', 'Returned HTML source and any mixed metadata remain bundled.', null, null, paths.filter(path => /\.html?$/i.test(path))];
  if (code.includes('web__run') && !object) return ['docs', `Documentation: ${code.includes('search_query') ? 'search' : code.includes('find:') ? 'excerpts' : 'page fetch'}`, 'Returned documentation, including navigation and repeated passages.'];
  if ((Array.isArray(object) && object.some(item => item?.name && item?.description)) || (object?.name && object?.description)) return ['tools', 'Tool metadata and schema discovery', 'Returned descriptions and schemas, separate from their server-side availability.'];
  if (object?.names || code.includes('const groups = {}')) return ['tools', 'Tool registry name listings', 'Returned names do not imply that all parameter schemas were loaded.'];
  if (code.includes('t3_thread_read') || code.includes('t3_thread_list')) return ['tools', 'Thread metadata results', 'Returned thread metadata and wrappers.'];
  if (code.includes('.codex/sessions')) return ['tools', 'Local session lookup results', 'Only returned text is estimated; files merely read by a script do not enter model context.'];
  if (code.includes('html_preview') || code.includes('html_render')) return ['tools', 'Preview and render metadata', 'Textual results only. Image token costs remain unattributed.'];
  if (command && file) return ['files', basename(file), 'Returned file text and its wrapper; compound command output may be mixed.', null, null, [file]];
  return ['tools', 'Execution results and wrappers', 'Returned execution headers, directory listings, checks, or other results.'];
}

export function buildReport(events, at) {
  if (at && !Number.isFinite(Date.parse(at))) throw new Error('Invalid --at timestamp');
  const records = measurements(events);
  const chosen = records.filter(record => !at || Date.parse(record.timestamp) <= Date.parse(at)).at(-1);
  if (!chosen) throw new Error('No recorded request usage for this snapshot');
  const first = records[0];
  const valid = usage => Number.isFinite(usage?.input_tokens) && usage.input_tokens >= 0 && Number.isFinite(usage.output_tokens) && usage.output_tokens >= 0 && usage.total_tokens === usage.input_tokens + usage.output_tokens && (usage.reasoning_output_tokens || 0) <= usage.output_tokens && (usage.reasoning_output_tokens || 0) >= 0;
  if (!valid(chosen.usage) || !valid(first.usage)) throw new Error('Unsupported token accounting; cannot safely reconcile input and output');
  if (!Number.isFinite(chosen.capacity) || chosen.capacity <= 0) throw new Error('Session context capacity is unavailable');
  const values = record => ({ timestamp: record.timestamp, input: record.usage.input_tokens, total: record.usage.total_tokens });
  const telemetry = { capacity: chosen.capacity, first: values(first), latest: values(chosen) };
  const groups = GROUPS.map(([id, name, color]) => ({ id, name, color, items: [], tokens: 0, kind: id === 'response' ? 'Measured' : id === 'unknown' ? 'Remainder' : 'Estimated' }));
  const inventory = new Map();
  const addInventory = item => {
    const key = `${item.type}:${item.name}`, previous = inventory.get(key);
    inventory.set(key, { ...previous, ...item, paths: uniquePaths([...(previous?.paths || []), ...(item.paths || [])]) });
  };
  const instruction = (name, status, paths = []) => addInventory({ name, paths, type: 'Agent instructions', group: 'Instruction files', status: inventory.get(`Agent instructions:${name}`)?.status === 'Read' ? 'Read' : status, description: 'Agent-instruction text supplied or returned in this session.', detail: 'Shown separately from skill catalogs and SKILL.md files. Historical evidence does not guarantee retention after compaction.' });
  const add = (id, name, tokens, note, kind = 'Estimated', paths = []) => {
    if (!tokens) return;
    const group = groups.find(item => item.id === id);
    const existing = group.items.find(item => item.name === name && item.note === note && item.kind === kind && JSON.stringify(item.paths) === JSON.stringify(paths));
    if (existing) { existing.tokens += tokens; existing.occurrences++; }
    else group.items.push({ name, tokens, note, kind, paths, occurrences: 1 });
    group.tokens += tokens;
  };
  const previous = records[records.indexOf(chosen) - 1];
  const previousIndex = previous?.index ?? -1;
  const generatedIndex = events.findIndex((event, index) => index > previousIndex && index < chosen.index && event.type === 'response_item' && generated(event.payload));
  const cutoff = generatedIndex < 0 ? chosen.index : generatedIndex;
  const inputEvents = events.slice(0, cutoff);
  const firstGenerated = inputEvents.findIndex(event => event.type === 'response_item' && generated(event.payload));
  const startupEnd = firstGenerated < 0 ? inputEvents.length : firstGenerated;
  let startupEstimate = 0, laterEstimate = 0, images = 0;
  const startup = (id, name, text, note, paths = []) => { const size = estimate(text); startupEstimate += size; add(id, name, size, note, 'Estimated', paths); };
  const partPaths = (p, index) => {
    const metadata = p.internal_chat_message_metadata_passthrough?.content_item_metadata?.[index];
    return metadataPaths(p.content[index], metadata, metadata?.provenance);
  };
  for (const event of inputEvents.slice(0, startupEnd)) {
    const p = event.payload;
    if (event.type !== 'response_item') continue;
    if (p.type === 'additional_tools') for (const namespace of p.tools || []) for (const tool of namespace.tools || []) {
      const name = `${namespace.name}.${tool.name}`;
      startup('tools', name, JSON.stringify(tool), 'Serialized startup tool definition, including description and schema.');
      addInventory({ name, type: 'Tools', group: 'Supplied definitions', status: 'Exposed', description: 'Tool definition supplied in the session log.', detail: 'This is an observed definition, not proof that the tool was called.' });
    }
    if (p.type === 'message' && ['user', 'developer'].includes(p.role)) for (const [index, part] of (p.content || []).entries()) if (part.text) {
      const name = instructionHeading(part.text);
      if (name) { const paths = uniquePaths([...partPaths(p, index), ...(name.includes('/') ? [name] : [])]); startup('agents', name, part.text, 'Agent instructions supplied in the startup context; individual share estimated.', paths); instruction(name, 'Supplied', paths); }
      else if (p.role === 'user') startup('conversation', part.text.includes('<environment_context>') ? 'Initial environment context' : 'Opening user context', part.text, 'User-supplied startup text; individual share estimated.');
    }
  }
  const calls = new Map();
  const roots = new Map();
  for (const event of inputEvents) if (event.type === 'response_item' && event.payload.type === 'message' && event.payload.role === 'developer') for (const part of event.payload.content || []) for (const line of (part.text || '').split('\n')) {
    const root = line.match(/^- `([^`]+)` = `([^`]+)`$/);
    if (root) roots.set(root[1], root[2]);
  }
  function catalogPath(line) {
    const path = line.match(/\(file:\s*(.*?)\)\s*$/)?.[1];
    if (!path) return [];
    const slash = path.indexOf('/'), root = roots.get(path.slice(0, slash));
    return [root ? `${root}/${path.slice(slash + 1)}` : path];
  }
  function attachments(p) {
    if (p.type !== 'message' || p.role !== 'user') return;
    const metadata = p.internal_chat_message_metadata_passthrough;
    const entries = [...(p.attachments || [])];
    for (const [index, part] of (p.content || []).entries()) {
      const meta = metadata?.content_item_metadata?.[index];
      if (['input_file', 'file', 'attachment'].includes(part.type) || /attachment|file|image/i.test(metadata?.content_item_kinds?.[index] || '') || (part.type === 'input_image' && (part.filename || metadataPaths(part).length))) entries.push({ ...meta?.provenance, ...meta, ...part });
    }
    for (const attachment of entries) {
      const paths = metadataPaths(attachment, attachment.provenance);
      const name = attachment.filename || attachment.name || (paths[0] && basename(paths[0]));
      if (!name) continue;
      addInventory({ name, paths, type: 'Files', group: 'Conversation attachments', status: 'Attached', description: 'Attachment reference observed in the conversation.', detail: 'Only recorded filenames and local paths are retained. File payloads and provider IDs are excluded. An attachment reference does not provide a separate measured token cost.' });
    }
  }
  function inspectMetadata(raw) {
    const data = parse(raw);
    if (Array.isArray(data)) { for (const item of data) inspectMetadata(JSON.stringify(item)); return; }
    if (!data || typeof data !== 'object') return;
    if (data.result?.value?.output) inspectMetadata(data.result.value.output);
    for (const name of data.names || []) if (typeof name === 'string') addInventory({ name, type: 'Tools', group: 'Registry', status: 'Registry', description: 'Tool name observed in a registry listing.', detail: 'Registry membership does not establish that its full schema entered context or its service is connected.' });
    if (data.name && data.description) addInventory({ name: data.name, type: 'Tools', group: 'Discovered metadata', status: 'Registry', description: 'Tool metadata observed in a discovery result.', detail: 'Returned metadata is counted separately from supplied startup definitions.' });
  }
  for (const [index, event] of inputEvents.entries()) {
    const p = event.payload;
    if (event.type !== 'response_item') continue;
    attachments(p);
    if (p.type === 'message' && p.role === 'developer') for (const part of p.content || []) for (const line of (part.text || '').split('\n')) if (line.startsWith('- ') && line.includes('(file:') && line.includes(': ')) {
      const name = line.slice(2, line.indexOf(': ', 2));
      const key = `Skills:${name}`;
      if (!inventory.has(key)) {
        const paths = catalogPath(line);
        addInventory({ name, paths, type: 'Skills', group: 'Observed catalog', status: 'Catalog', description: 'Skill summary and location supplied in the catalog.', detail: 'Catalog presence is distinct from reading its full instructions.' });
        if (index < startupEnd) startup('skills', `${name} · catalog entry`, line, 'Catalog summary and file location only, not the full skill body.', paths);
      }
    }
    if (index < startupEnd) continue;
    const later = (id, name, text, note, paths = []) => { const size = estimate(text); laterEstimate += size; add(id, name, size, note, 'Estimated', paths); };
    if (p.type === 'message' && ['user', 'assistant', 'developer'].includes(p.role)) for (const [partIndex, part] of (p.content || []).entries()) if (part.text) {
      const name = p.role !== 'assistant' && instructionHeading(part.text);
      if (name) { const paths = uniquePaths([...partPaths(p, partIndex), ...(name.includes('/') ? [name] : [])]); later('agents', name, part.text, 'Agent instructions supplied later in the session; individual share estimated.', paths); instruction(name, 'Supplied', paths); }
      else if (p.role !== 'developer') later('conversation', p.role === 'user' ? 'Later user requests' : 'Assistant replies and updates', part.text, 'Visible conversation text; private reasoning is not extracted.');
    }
    if (/tool_call$/.test(p.type)) {
      const code = p.input || p.arguments || '';
      calls.set(p.call_id, code);
      later('tools', `${p.name || 'tool'} · call payloads`, code, 'Retained tool input code/arguments, separate from returned results.');
    }
    if (/tool_call_output$/.test(p.type)) {
      const parts = Array.isArray(p.output) ? p.output : typeof p.output === 'string' ? [{ text: p.output }] : [];
      for (const part of parts) {
        if (part.type === 'input_image') { images++; continue; }
        if (!part.text) continue;
        const [id, name, note, skill, agent, recordedPaths = []] = classify(part.text, calls.get(p.call_id) || '');
        const paths = uniquePaths([...recordedPaths, ...(skill && !recordedPaths.length ? inventory.get(`Skills:${skill}`)?.paths || [] : [])]);
        later(id, name, part.text, note, paths);
        inspectMetadata(part.text);
        if (skill) addInventory({ name: skill, paths, type: 'Skills', group: 'Observed skill reads', status: 'Read', description: 'Full skill instructions returned in this session.', detail: 'Historical read evidence; after compaction it is not proof of current retention.' });
        if (agent) instruction(agent, 'Read', paths);
        if (id === 'files') addInventory({ name, paths, type: 'Files', group: 'Returned file text', status: 'Read', description: 'File text observed in a returned tool result.', detail: note });
      }
    }
  }
  const compacted = inputEvents.some(event => /compact/i.test(event.type) || /compact/i.test(event.payload?.type || ''));
  const inconsistent = startupEstimate > first.usage.input_tokens || first.usage.input_tokens + laterEstimate > chosen.usage.input_tokens;
  let limitation = '';
  if (compacted || inconsistent) {
    for (const group of groups) { group.items = []; group.tokens = 0; }
    limitation = compacted ? 'Compaction was recorded; retained input sources cannot be reconstructed from the historical log.' : 'Text-size estimates exceed the measured input; individual input attribution is unavailable.';
    add('unknown', 'Input attribution unavailable', chosen.usage.input_tokens, limitation, 'Remainder');
  } else {
    add('unknown', 'Startup setup and unitemized overhead', first.usage.input_tokens - startupEstimate, 'Remainder of measured startup input after estimated public definitions, catalogs, and user text. Includes private setup.', 'Remainder');
    add('unknown', 'Unattributed later input', chosen.usage.input_tokens - first.usage.input_tokens - laterEstimate, `Remainder includes ${images} logged images, prior opaque reasoning, unseen framing, and tokenizer mismatch.`, 'Remainder');
  }
  const reasoning = chosen.usage.reasoning_output_tokens || 0;
  add('response', 'Selected generated reasoning', reasoning, 'Measured reasoning count only; its content is never extracted or displayed.', 'Measured');
  add('response', 'Selected response text / tool payload', chosen.usage.output_tokens - reasoning, 'Measured output minus measured reasoning; reasoning is not counted twice.', 'Measured');
  const sources = [
    ['User instructions', 'Supplied', 'User-provided project rules and preferences.'],
    ['Platform guidance', 'Summary', 'General assistant behavior and safety guidance.'],
    ['Coding-agent guidance', 'Summary', 'Collaboration, engineering, and tool-use guidance.'],
    ['Host integration guidance', 'Summary', 'Session host and integration behavior.'],
    ['Session environment', 'Observed', 'Session identity, workspace, and configured capacity.'],
    ['Conversation and tool results', 'Observed', 'Observed session messages and returned results.'],
  ];
  for (const [name, status, description] of sources) addInventory({ name, type: 'Sources', group: 'Session sources', status, description, detail: 'Source labels summarize observed session context; private instruction bodies and raw messages are not embedded.' });
  const method = 'Total occupancy and selected response counts are measured. Source estimates use ceil(UTF-8 bytes / 4), not the model tokenizer. Startup source estimates reconcile to measured startup input; later visible text is estimated separately. Repeated text and wrappers count each time. Mixed results stay bundled. Unattributed tokens are not distributed among sources or normalized to fit. Inventory records historical observations, not guaranteed retention after compaction. This is a static snapshot at the displayed time. ' + limitation;
  return { telemetry, attribution: { snapshot: chosen.timestamp, groups: groups.filter(group => group.tokens > 0), method }, inventory: [...inventory.values()] };
}

export function buildInspectionReport(events, messageId) {
  const requests = events.flatMap((event, index) => {
    const p = event.type === 'response_item' ? event.payload : null;
    if (p?.type !== 'message' || p.role !== 'user') return [];
    const kinds = p.internal_chat_message_metadata_passthrough?.content_item_kinds;
    const userContent = kinds?.length ? kinds.some(kind => kind.startsWith('user.') || /attachment/.test(kind)) : (p.content || []).some(part => part.type === 'input_file' || (part.text && !instructionHeading(part.text) && !part.text.includes('<environment_context>')));
    return userContent ? [{ index, id: p.id, timestamp: event.timestamp }] : [];
  });
  const request = messageId ? requests.find(item => item.id === messageId) : requests.at(-1);
  if (!request) throw new Error('Inspection request not found; identify its user message before generating the report');
  const prior = events.slice(0, request.index);
  if (!measurements(prior).length) throw new Error('No recorded context usage before the inspection request; a pre-request percentage is unavailable');
  const report = buildReport(prior);
  report.telemetry.scope = 'before-request';
  report.telemetry.beforeRequest = { id: request.id, timestamp: request.timestamp };
  report.attribution.method += ' This report uses the last completed measurement before the inspection request. The request itself and all later diagnostic work are excluded; the reading may precede the exact request time.';
  return report;
}

export function renderReport(report, template) {
  const encode = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return template.replace('__CONTEXT_INVENTORY__', () => encode(report.inventory))
    .replace('__CONTEXT_TELEMETRY__', () => encode(report.telemetry))
    .replace('__CONTEXT_ATTRIBUTION__', () => encode(report.attribution));
}

function main(args) {
  if (args.includes('--help')) { console.log('node render.mjs --session SESSION.jsonl --out REPORT.html [--cwd WORKSPACE] [--before-message MESSAGE_ID | --at ISO_TIMESTAMP]'); return; }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--session', '--out', '--cwd', '--at', '--before-message'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Expected --session, --out, optional --cwd, --before-message or --at values');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.session || !options.out) throw new Error('Both --session and --out are required');
  if (options.at && options['before-message']) throw new Error('--at and --before-message select different snapshot modes; use only one');
  const events = readSession(readFileSync(options.session, 'utf8'));
  const meta = events.find(event => event.type === 'session_meta');
  if (!meta?.payload?.cwd || resolve(meta.payload.cwd) !== resolve(options.cwd || process.cwd())) throw new Error('Session workspace mismatch; select the correct session before rendering');
  const report = options.at ? buildReport(events, options.at) : buildInspectionReport(events, options['before-message']);
  const template = readFileSync(new URL('../assets/context-window.html', import.meta.url), 'utf8');
  const destination = resolve(options.out);
  if (destination === resolve(options.session)) throw new Error('Output cannot overwrite the source session log');
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, renderReport(report, template), 'utf8');
  console.log(JSON.stringify({ path: destination, timestamp: report.telemetry.latest.timestamp, used: report.telemetry.latest.total, capacity: report.telemetry.capacity }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
