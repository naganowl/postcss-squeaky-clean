/* eslint-disable template-curly-spacing */

const runShell = require('./run-shell');

// String of space separated directory paths to search through
let directoryList;

module.exports = {
  init(opts) {
    const { directories } = opts;
    directoryList = directories.join(' ');
  },
  /*
    Given an array of squeaky selectors, find the files in which they are located.
  */
  find(sqkdSelector) {
    // Exclusions handled directly within this command (problem when command is run explicitly).
    const filterCmd = `
      ${ /* Split selector on the period from the class selector */'' }
      cut -c2- |
      ${ /* Find usages of the class selector in non-stylesheet files */'' }
      xargs -I '{}' grep -rl --exclude=*.{css,scss} {} ${directoryList} |
      ${ /* Sort the list and remove duplicates */'' }
      sort -u
    `;
    // Obtain only the view files that contain a top level squeaky class selector.
    const sqkdFiles = runShell('sh', ['-c', `echo ${sqkdSelector} | grep sqkd |
      ${ /* Convert the commas (since it's an array) into new lines so that it can be piped through */'' }
      tr ',' '\n' |
      ${filterCmd}
    `]);

    return sqkdFiles.split('\n').filter(sFile =>
      // Remove empty strings and falsy values
      sFile);
  },
};
