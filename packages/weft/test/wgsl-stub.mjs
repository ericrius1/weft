// For a test that loads a module importing .wgsl (kit.ts, through budget.ts): each shader an empty stand-in — what
// the test runs never draws.
export async function load(url, context, next) {
  if (url.endsWith('.wgsl')) return { format: 'module', source: 'export default { structs: {}, reflect: { structs: {}, bindings: {}, entries: [], overrides: {} } };', shortCircuit: true };
  return next(url, context);
}
