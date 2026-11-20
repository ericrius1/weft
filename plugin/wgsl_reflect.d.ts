declare module 'wgsl_reflect/wgsl_reflect.module.js' {
  // the plugin walks wgsl_reflect's results structurally; see node_modules/wgsl_reflect/types for the full shapes
  export const WgslReflect: new (code: string) => any;
  export const WgslParser: new () => { parse(code: string): any[] };
  /** the tokenizer's token and keyword types (the plugin corrects one of the parser's methods with them: wgsl.ts) */
  export const TokenTypes: { tokens: Record<string, unknown>; keywords: Record<string, unknown> };
}
