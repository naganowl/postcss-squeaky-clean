const path = require('path');

let directories;
let pathRoot;

module.exports = {
  init(opts) {
    /* eslint-disable prefer-destructuring */
    directories = opts.directories;
    pathRoot = opts.pathRoot;
    /* eslint-enable prefer-destructuring */
  },
  calculate(directoriesToUse) {
    let directoryList = directoriesToUse || directories;

    if (typeof directoryList === 'string') {
      directoryList = directoryList.split(',');
    }

    return directoryList.map(directory => path.join(pathRoot, directory));
  },
};
