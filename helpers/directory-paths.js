const path = require('path');

let directories;
let pathRoot;

module.exports = {
  init(opts) {
    ({ directories, pathRoot } = opts);
  },
  calculate(directoriesToUse) {
    let directoryList = directoriesToUse || directories;

    if (typeof directoryList === 'string') {
      directoryList = directoryList.split(',');
    }

    return directoryList.map(directory => path.join(pathRoot, directory));
  },
};
