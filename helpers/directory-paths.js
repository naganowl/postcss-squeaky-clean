const path = require('path');

let pathRoot;

module.exports = {
  init: function(opts) {
    directories = opts.directories;
    pathRoot = opts.pathRoot;
  },
  calculate: function (directoriesToUse) {
    let directoryList = directoriesToUse || directories;

    if (typeof directoryList === 'string') {
      directoryList = directoryList.split(',');
    }

    return directoryList.map((directory) => {
      return path.join(pathRoot, directory);
    });
  },
}
