const path = require('path');

let pathRoot;

module.exports = {
  init(opts) {
    directories = opts.directories;
    pathRoot = opts.pathRoot;
  },
  calculate(directoriesToUse) {
    let directoryList = directoriesToUse || directories;

    if (typeof directoryList === 'string') {
      directoryList = directoryList.split(',');
    }

    return directoryList.map(directory => path.join(pathRoot, directory));
  },
};
