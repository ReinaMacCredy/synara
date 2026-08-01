export function orchestratorChildAlias(threadId: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < threadId.length; index += 1) {
    hash ^= threadId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `child-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
