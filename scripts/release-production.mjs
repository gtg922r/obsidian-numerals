// Unconditional: neither a missing policy file nor an environment flag can enable promotion.
console.error('Production publication and promotion are disabled during recovery. Stable remains 1.10.2. Only the owner may run release:beta for a reviewed BRAT prerelease.');
process.exitCode = 1;
