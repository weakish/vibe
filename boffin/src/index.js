import { KILL_GRACE_MS } from './agent.js';
import { ConfigError, loadConfig } from './config.js';
import { Conversation, StateError } from './conversation.js';
import { createServer } from './server.js';

// Longer than the SIGTERM grace so a stuck CLI can be SIGKILL'd before we exit
// and leave a detached process group behind.
const SHUTDOWN_TIMEOUT_MS = KILL_GRACE_MS + 5000;

function main() {
  const workdir = process.argv[2] ?? process.cwd();
  let config;
  let conversation;
  let server;
  try {
    config = loadConfig(workdir);
    conversation = new Conversation({
      model: config.model,
      grokModel: config.grokModel,
      piModel: config.piModel,
      workdir: config.workdir,
      agentBin: config.agentBin,
      grokBin: config.grokBin,
      piBin: config.piBin,
      force: config.force,
      agents: config.agents,
      stateFile: config.stateFile,
    });
    server = createServer({
      conversation,
      username: config.username,
      password: config.password,
      bunBin: config.bunBin,
    });
  } catch (error) {
    if (error instanceof ConfigError || error instanceof StateError) {
      console.error(`[boffin] ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  server.on('error', (error) => {
    console.error(`[boffin] ${error.stack || error}`);
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    const displayHost = config.host.includes(':') ? `[${config.host}]` : config.host;
    console.log(`[boffin] listening on http://${displayHost}:${config.port}`);
    console.log(`[boffin] workdir: ${config.workdir}`);
    console.log(`[boffin] agents: ${config.agents.join(', ')}`);
    console.log(`[boffin] model: ${conversation.model}`);
    if (config.created) {
      console.log(`[boffin] wrote ${config.configFile}`);
    }
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    const forceExit = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    let exitCode = 0;
    try {
      await conversation.stop();
    } catch (error) {
      exitCode = 1;
      console.error(`[boffin] shutdown failed: ${error.stack || error}`);
    }
    server.close(() => process.exit(exitCode));
    server.closeAllConnections();
  };
  const onSignal = () => {
    if (shuttingDown) {
      conversation.kill();
      process.exit(1);
    }
    void shutdown();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}

main();
