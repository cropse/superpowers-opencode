import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

// Unit test for the superpowers.jsonc agent merge in the plugin's config hook.
// Follows the fake-API style of test-bootstrap-caching.mjs.
//
// Usage: node test-agent-config.mjs PLUGIN_PATH

const [, , pluginPath] = process.argv;
if (!pluginPath) {
  console.error('Usage: node test-agent-config.mjs PLUGIN_PATH');
  process.exit(2);
}

// Import the plugin with OPENCODE_CONFIG_DIR set for this case. The env var is
// read at plugin-init time, so each case needs its own fresh module instance.
const loadPlugin = async (envValue) => {
  const wrapper = `process.env.OPENCODE_CONFIG_DIR = ${JSON.stringify(envValue)}; const m = await import(${JSON.stringify(pathToFileURL(pluginPath).href)}); export default m;`;
  const wrapperUrl = 'data:text/javascript;base64,' + Buffer.from(wrapper).toString('base64');
  const mod = await import(wrapperUrl);
  const pluginFn = mod.default?.SuperpowersPlugin || mod.default?.default?.SuperpowersPlugin;
  if (typeof pluginFn !== 'function') {
    throw new Error(`SuperpowersPlugin export not found (keys: ${Object.keys(mod.default || {}).join(', ')})`);
  }
  return pluginFn({ client: {}, directory: '.' });
};

const failures = [];
const check = (name, cond, msg) => {
  if (!cond) failures.push(`${name}: ${msg}`);
};

const writeConfig = (dir, content) => {
  fs.writeFileSync(path.join(dir, 'superpowers.jsonc'), content);
};
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sp-agent-test-'));

// --- Case 1: superpowers.jsonc present with agents -------------------------
{
  const dir = mk();
  writeConfig(dir, `{
  // comment
  "agent": {
    "sp-cheap": { "mode": "subagent", "model": "test/cheap" },
    "sp-review-strong": { "mode": "subagent", "model": "test/strong" }
  }
}`);
  const plugin = await loadPlugin(dir);
  const config = {};
  await plugin.config(config);
  check('present', config.agent?.['sp-cheap']?.model === 'test/cheap',
    `expected sp-cheap merged from file, got ${JSON.stringify(config.agent?.['sp-cheap'])}`);
  check('present', config.agent?.['sp-review-strong']?.model === 'test/strong',
    `expected sp-review-strong merged from file, got ${JSON.stringify(config.agent?.['sp-review-strong'])}`);
}

// --- Case 2: user config wins per-agent -------------------------------------
{
  const dir = mk();
  writeConfig(dir, `{
  "agent": {
    "sp-cheap": { "mode": "subagent", "model": "file/cheap" },
    "sp-standard": { "mode": "subagent", "model": "file/standard" }
  }
}`);
  const plugin = await loadPlugin(dir);
  const config = { agent: { 'sp-cheap': { model: 'user/cheap' } } };
  await plugin.config(config);
  check('user-wins', config.agent['sp-cheap']?.model === 'user/cheap',
    `expected user sp-cheap to win, got ${JSON.stringify(config.agent['sp-cheap'])}`);
  check('user-wins', config.agent['sp-standard']?.model === 'file/standard',
    `expected file sp-standard to fill gap, got ${JSON.stringify(config.agent['sp-standard'])}`);
}

// --- Case 3: broken JSONC must not break the hook ---------------------------
{
  const dir = mk();
  writeConfig(dir, '{ broken json !!!');
  const plugin = await loadPlugin(dir);
  const config = {};
  await plugin.config(config);
  check('invalid', !config.agent || Object.keys(config.agent).length === 0,
    `expected no agents merged from broken file, got ${JSON.stringify(config.agent)}`);
  check('invalid', Array.isArray(config.skills?.paths) && config.skills.paths.length > 0,
    'expected skills.paths registration to still work');
}

// --- Case 4: no superpowers.jsonc at all -------------------------------------
{
  const dir = mk();
  const plugin = await loadPlugin(dir);
  const config = {};
  await plugin.config(config);
  check('missing', !config.agent || Object.keys(config.agent).length === 0,
    `expected no agents when file absent, got ${JSON.stringify(config.agent)}`);
  check('missing', Array.isArray(config.skills?.paths) && config.skills.paths.length > 0,
    'expected skills.paths registration to still work');
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log('All agent-config tests passed');
console.log('cases: present, user-wins, invalid, missing');