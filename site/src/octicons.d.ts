// @primer/octicons ships no types; only toSVG is used, at build time.
declare module '@primer/octicons' {
  const octicons: Record<string, { toSVG(opts?: Record<string, string | number>): string }>;
  export default octicons;
}
