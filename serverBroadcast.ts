// Client-side shim; real broadcasting occurs only on server runtime.
export function broadcastActivity(_orgId: string, _event: any) {
  // noop in browser
}