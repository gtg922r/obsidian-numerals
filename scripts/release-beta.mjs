// Unconditional: default-branch maintenance cannot create or publish tags.
console.error('Publication from stable maintenance is disabled. The owner must use the reviewed chore/recovery-1.11 checkout for BRAT prereleases. Stable remains 1.10.2; production promotion is prohibited.');
process.exitCode = 1;
