// a value that is anything: every property a function returning itself
const h: ProxyHandler<any> = { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : P), apply: () => P, construct: () => P };
export const P: any = new Proxy(function () {}, h);
