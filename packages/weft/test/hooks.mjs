// dist/src's modules import each other without extensions (they're written for a bundler): a test that loads one
// registers this first (module.register) so Node finds each import's .js.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (/^\.\.?\//.test(specifier) && !/\.m?js$/.test(specifier)) return next(`${specifier}.js`, context);
    throw e;
  }
}
