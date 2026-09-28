import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

// Unit test for the superpowers.jsonc agent merge on V2, via
// ctx.agent.transform() inside default.setup(). Mirrors test-agent-config.mjs
// (the V1 config-hook equivalent) but drives the V2 setup() path.
//
// Usage: node test-agent-config-v2.mjs PLUGIN_PATH

const [, , pluginPath] = process.argv;
if (!pluginPath) {
  console.error('Usage: node test-agent-config-v2.mjs PLUGIN_PATH');
  process.exit(2);
}

// Import the plugin with OPENCODE_CONFIG_DIR set for this case. The env var is
// read at setup-time via resolveConfigDir(), so each case needs its own fresh
// module instance.
const loadPlugin = async (envValue) => {
  const wrapper = `process.env.OPENCODE_CONFIG_DIR = ${JSON.stringify(envValue)}; const m = await import(${JSON.stringify(pathToFileURL(pluginPath).href)}); export default m;`;
  const wrapperUrl = 'data:text/javascript;base64,' + Buffer.from(wrapper).toString('base64');
  const mod = await import(wrapperUrl);
  const plugin = mod.default?.default;
  if (!plugin || typeof plugin.setup !== 'function') {
    throw new Error(`default.setup export not found (keys: ${Object.keys(mod.default || {}).join(', ')})`);
  }
  return plugin;
};

// Minimal V2-shaped ctx: enough to satisfy setup()'s V1-vs-V2 detection and
// exercise ctx.agent.transform(). Skill registration and the bootstrap hook
// are stubbed out — out of scope for this test.
const makeCtx = (preexisting = {}) => {
  const updates = {};
  return {
    ctx: {
      skill: { transform: async (fn) => { await fn({ add: () => {}, list: () => [], get: () => undefined, update: () => {}, remove: () => {} }); } },
      agent: {
        transform: async (fn) => {
          await fn({
            get: (name) => (name in preexisting ? preexisting[name] : updates[name]),
            update: (name, updater) => {
              const agent = { ...(preexisting[name] || updates[name] || {}) };
              updater(agent);
              updates[name] = agent;
            },
          });
        },
      },
      session: { hook: async () => {}, get: async () => ({}) },
    },
    updates,
  };
};

const failures = [];
const check = (name, cond, msg) => {
  if (!cond) failures.push(`${name}: ${msg}`);
};

const writeConfig = (dir, content) => {
  fs.writeFileSync(path.join(dir, 'superpowers.jsonc'), content);
};
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sp-agent-v2-test-'));

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
  const { ctx, updates } = makeCtx();
  await plugin.setup(ctx);
  check('present', updates['sp-cheap']?.model?.providerID === 'test' && updates['sp-cheap']?.model?.id === 'cheap',
    `expected sp-cheap merged from file with parsed model, got ${JSON.stringify(updates['sp-cheap'])}`);
  check('present', updates['sp-review-strong']?.model?.providerID === 'test' && updates['sp-review-strong']?.model?.id === 'strong',
    `expected sp-review-strong merged from file with parsed model, got ${JSON.stringify(updates['sp-review-strong'])}`);
}

// --- Case 2: user-defined agent wins per-agent ------------------------------
{
  const dir = mk();
  writeConfig(dir, `{
  "agent": {
    "sp-cheap": { "mode": "subagent", "model": "file/cheap" },
    "sp-standard": { "mode": "subagent", "model": "file/standard" }
  }
}`);
  const plugin = await loadPlugin(dir);
  const { ctx, updates } = makeCtx({ 'sp-cheap': { model: { providerID: 'user', id: 'cheap' } } });
  await plugin.setup(ctx);
  check('user-wins', updates['sp-cheap']?.model?.providerID === 'user',
    `expected pre-existing sp-cheap to be left untouched, got ${JSON.stringify(updates['sp-cheap'])}`);
  check('user-wins', updates['sp-standard']?.model?.providerID === 'file' && updates['sp-standard']?.model?.id === 'standard',
    `expected file sp-standard to fill gap, got ${JSON.stringify(updates['sp-standard'])}`);
}

// --- Case 3: broken JSONC must not break setup() -----------------------------
{
  const dir = mk();
  writeConfig(dir, '{ broken json !!!');
  const plugin = await loadPlugin(dir);
  const { ctx, updates } = makeCtx();
  await plugin.setup(ctx);
  check('invalid', Object.keys(updates).length === 0,
    `expected no agents merged from broken file, got ${JSON.stringify(updates)}`);
}

// --- Case 4: no superpowers.jsonc at all -------------------------------------
{
  const dir = mk();
  const plugin = await loadPlugin(dir);
  const { ctx, updates } = makeCtx();
  await plugin.setup(ctx);
  check('missing', Object.keys(updates).length === 0,
    `expected no agents when file absent, got ${JSON.stringify(updates)}`);
}

// --- Case 5: ctx without an agent domain (older/narrower V2 host) must not throw --
{
  const dir = mk();
  writeConfig(dir, `{ "agent": { "sp-cheap": { "mode": "subagent", "model": "test/cheap" } } }`);
  const plugin = await loadPlugin(dir);
  const { ctx } = makeCtx();
  delete ctx.agent;
  let threw = null;
  try {
    await plugin.setup(ctx);
  } catch (err) {
    threw = err;
  }
  check('no-agent-domain', threw === null, `expected setup() to tolerate a missing ctx.agent, but it threw: ${threw?.message}`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log('All V2 agent-config tests passed');
console.log('cases: present, user-wins, invalid, missing, no-agent-domain');
