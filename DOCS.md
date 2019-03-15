# API

There are four plugins for each of the phases which depend on the previous phase (except the `clean` plugin), however each phase leaves the code in a functioning state.

## `clean` plugin

This adds the namespaces (suffixes) to all selectors and takes the following options:

### `directories`

An array of strings representing file paths which contain the top level directories which the plugin will recursive analyze for class selectors

### `fileExts`

A comma, delineated string representing file extensions that will be examined for class selectors within `directories`

### `blacklistedClasses`

An object with two keys (`BLACKLIST_CLASSES` and `BLACKLIST_PREFIXES`) whose values are both an array of strings which are class selectors (including the period!).
These selectors will be ignored (skipped from namespacing) in stylesheets. The selectors in `BLACKLIST_PREFIXES` will ignore class selectors that begin with those strings.

For one off selectors that would be skipped, adding a comment next to the selector in the stylesheets (e.g. `// squeaky-skip`) will allow the plugin to ignore namespacing the selector.

### `regExps`

An array of strings that represent regular expressions to target specific internal/helper method invocations within a codebase that can be targeted by
the plugin. See 0c645c5 for an example.

# Usage

An [example script](./examples/scss-parser.js) demonstrates how the plugins can be hooked up with PostCSS. If placed in the directory `scripts/node`, the `clean` plugin can be executed with

`node scripts/node/scss-parser.js path/to/stylesheet.scss --clean`

The `analytics` plugin can be run with

`node scripts/node/scss-parser.js path/to/stylesheet.scss --analyze`

Selector specificity can be observed with

`node scripts/node/scss-parser.js path/to/stylesheet.scss --specify`

# Linting

To check for any dangling namespaced selectors, the following command can be run

`squeaky-lint --directoriesPath <FILE_PATH> --pathRoot <FILE_PATH> --composeDir`

where `directoriesPath` points to a module which returns an array of strings denoting file directories to lint
and `pathRoot` is a file path that's the top level directory of the code to be analyzed
with `composeDir` being a comma delineated string of the directories that have stylesheets implementing CSS composition
then `ext` can be used with a comma delineated string to specify the extensions for view files to scan for squeaky selectors

# Statistics

There are two auxiliary plugins that help collect data to assist with the movement between the squeaky phases

## `analytics` plugin

After a stylesheet has been namespaced (run through phase 1, the `clean` plugin), it can be checked for how "clean" the stylesheet is relative to the codebase.
This is determined by checking the base/original (without the suffix) selector and seeing if all occurrences of that selector have been converted
to CSS modules. This is done by checking if the selector processed in the current stylesheet is the only place that still has a namespace. A stylesheet that contains
only namespaced selectors that are present in the current stylesheet means that it's selectors have been completely isolated to a file.

The plugin takes the following options:

### `scssSheets`

A newline separated string of SCSS files. This typically is the result of a Shell command (such as `find`) to aggregate necessary files

## `specificity` plugin

If a given page layout pulls in a number of stylesheets, trying to flatten those selectors may lead to specificity conflicts because the selectors have
the same level of nesting, however depend on the order of files being loaded to break ties. These issues can be detected by running this plugin which
will check all namespaced selectors in a given stylesheet and output an object detailing the selectors + properties that have conflicts and the file
they source from.

See the following image for a better sense of the structure:

<img width="1037" alt="conflictsMap" src="https://user-images.githubusercontent.com/4563859/42901934-c73f8992-8a81-11e8-81f8-2fa310c61b38.png">

The following options can be passed in

### `scssPath`

A string representing the stylesheet to analyze

### `genericDir`

An array of directory strings which should be given less precedence (lose specificity ties). Usually utility + reset files

### `specificDir`

An array of directory strings which should be given more precedence (win specificity ties). Usually exceptional cases

## `heuristic` plugin

With namespaced selectors across all files, there's a 1:1 correlation where a selector in a given view/template file has a selector in a stylesheet that
defines it's styles. Since each namespaced selector has a unique key globally, the selector can directly target those elements which can happen if nesting
is removed from the stylesheet. The major obstacle preventing such a simple solution is that with a sufficiently sized codebase, there will be many stylesheets
which define nested selectors where a given DOM element can be targetted by multiple of such selectors. The flattening of a stylesheet will normalize the specificity
of all selectors at the cost of losing which styles should have precedence over others.

To alleviate this issue, a heuristic is applied in an attempt to remove namespaced selectors from all files, except for those that it's used in. This is accomplished
by starting with all files that contain a given selector and walking the dependency chain (provided by webpack, assuming that the codebase has been sufficiently
modularized with CommonJS modules) to determine the file hierarchy which actually utilize the styles. There can be some false positives generated from this process
and shared components that could be chunked/split via other webpack plugins. For the most part, this helps wipe out a majority of the extra namespaced selectors
that are scattered from the `clean` plugin (especially the generically named shared styles).

# Development

`yarn test` will run the specs, `yarn lint` will run `eslint` with the `airbnb` configuration

Specs can be debugged with `node --inspect-brk node_modules/jasmine/bin/jasmine.js specs/**/*.js`
