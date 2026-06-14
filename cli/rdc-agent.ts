#!/usr/bin/env node
/**
 * rdc-agent CLI entry point.
 */
import { runCli } from '../src/main/agent-runtime/cli/StandaloneCli';
const args = process.argv.slice(2);
runCli(args).catch((err) => {
  console.error('CLI fatal error:', err.message);
  process.exit(1);
});
