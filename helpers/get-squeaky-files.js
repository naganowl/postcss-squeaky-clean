const compact = require('lodash.compact');
const runShell = require('./run-shell');

let directoryList;
// Get a list of all view files with squeaky selectors
let findCmd;

// Return all view files which contain squeaky selectors
module.exports = {
  init(opts) {
    const { directories } = opts;
    directoryList = directories.join(' ');
    findCmd = `grep -rl --exclude=*.{css,scss} sqkd ${directoryList}`;
  },
  find() {
    return compact(runShell('sh', ['-c', findCmd]).split('\n'));
  },
};
