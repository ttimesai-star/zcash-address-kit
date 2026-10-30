// @noble/hashes 2.x calls Object.hasOwn (Node >= 16.9). bundle.mjs substitutes this helper so the
// bundles also load on Node 12 and 14, without patching any global.
export const __hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
