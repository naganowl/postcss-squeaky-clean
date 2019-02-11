const findAllFilesWithExt = require('./find-all-files-with-ext.js');

module.exports = function findAllFilesInDirectory(fileDirectories, extension) {
  return fileDirectories.reduce((memo, directory) =>
    memo.concat(findAllFilesWithExt(directory, extension)), []);
};
