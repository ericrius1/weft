declare module 'wgsl_reflect/wgsl_reflect.module.js' {
  // the plugin walks wgsl_reflect's results structurally; see node_modules/wgsl_reflect/types for the full shapes
  export const WgslReflect: new (code: string) => any;
  export const WgslParser: new () => { parse(code: string): any[] };
}
