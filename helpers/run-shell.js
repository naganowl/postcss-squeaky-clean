const childProcess = require('child_process');

module.exports = function runShell(cmd, args, options) {
  const output = childProcess.spawnSync(cmd, args, options);

  const errString = output.stderr.toString();
  if (errString) {
    console.log('\x1b[31m%s\x1b[0m', errString);
  }

  const results = output.stdout || '';
  return results.toString();
};
