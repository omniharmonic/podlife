/**
 * Inline scheduling optimizer (TypeScript port of the Python service in
 * apps/optimizer/). One function: `solve(request)`. The Python service is
 * preserved as a reference implementation and can still be deployed if
 * the inline path needs to be bypassed for some reason — see VERCEL.md.
 */
export { solve } from './solver.js';
