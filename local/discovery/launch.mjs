// Main entry point: the original Career-ops dashboard plus the existing
// discovery collector. The smaller discovery-only page remains optional.
try {
  await import(process.argv.includes('--discovery-only') ? './discovery-launch.mjs' : './native-launch.mjs');
} catch (error) {
  console.error(`\nInternship Desk could not start: ${error.message}`);
  process.exitCode = 1;
}
