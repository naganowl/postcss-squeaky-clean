const runShell = require('./run-shell');

let directoryList;
// Get a list of all view files with squeaky selectors
const findCmd = `grep -rl --exclude=*.{css,scss} sqkd ${directoryList}`;

// Return all view files which contain squeaky selectors
module.exports = {
  init(opts) {
    const { directories } = opts;
    directoryList = directories.join(' ');
  },
  find() {
    return runShell('sh', ['-c', findCmd]).split('\n').slice(0, -1);
  },
};