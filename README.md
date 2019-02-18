# squeaky-clean
A series of [PostCSS](https://github.com/postcss/postcss) plugins to transition global [SCSS](http://sass-lang.com/) stylesheets into [CSS modules](https://github.com/css-modules/css-modules)

## Overview
The main goal is to allow new features to be written like services, old features to be broken apart into smaller pieces which
both allows for faster deliverables since dependencies and the affected surfaces will be clearer.

Additionally, note that the squeaky clean parser uses regex to replace classes such that the following patterns will generally be search/replaced:

* `class=whatever` in a scss/css
* js variable names like: `<FOO>ClassName` in javascript
* `(add|remove|toggle)Class` in javascript, and any values in the string passed to these method calls will get converted

Additionally, the parser goes after:

* `klasses`
* `className`
* `_class`

#### Temporary variable names
Also note, that in order for the parser / regex mechanism to work, it needs a pattern to match against. Thus, string interpolation in SCSS should be refactored in to explicit and exposed names; and in JS interpolation and similar should be broken out in to a helper method where the values have been exposed and put in to a temp variable with the suffix `ClassName` convention. All this may seem counter intuitive, but the goal is that all these styles will get removed and converted to localized and composed styles that are trackable within our dependency graph.

#### Goals
The end goal is to have all legacy stylesheets converted into CSS modules, complete with generic style names and explicit
dependency chains. The extra namespacing in the stylesheets and additions to the DOM will eventually be cleaned up. Consider
them to be "braces" for the codebase.

#### Road map
The namespacing described above is a technical walkthrough of what's considered **Phase 1**. The step following that is to
flatten (i.e. remove the nesting) in the stylesheets to move them towards the [CSS modules](https://github.com/css-modules/css-modules) methodology that modern components follow (**Phase 2**). In doing so, the selectors need to be determined
where they're actually used so heuristics are used to determine where the selectors are used (**Phase 3**). Finally, the
namespaces can be cleaned up and the stylesheet is directly imported into the view files that use them (**Phase 4**).

All phases will be as automated as possible to allow for a straightforward transition between old global
level code to compartmentalized components with dependency chains for a clear idea of where the files are used and allow for
styles to be reused via [CSS composition](https://github.com/css-modules/css-modules#composition).

#### Why RegExps?

The academically inclined would point towards an [AST](https://en.wikipedia.org/wiki/Abstract_syntax_tree) for each file format to be able to properly target all class selectors. This would be costly for the following reasons:

1. Number of file formats needed to be parsed
1. Overhead to run + maintain + understand each of those parsers
1. Additional parsing of class selectors from string tokens extracted from files

To balance delivering results and provide reasonable script runtime, regular expressions are leveraged and have served quite well for the features that have run and the heavy conventions that exist within the files. If performance ever becomes an issue, ASTs can be revisited.

## API

There are four plugins for each of the phases which depend on the previous phase (except the `clean` plugin), however each phase leaves the code in a functioning state.

### `clean` plugin

This adds the namespaces (suffixes) to all selectors and takes the following options:

#### `directories`

An array of strings representing file paths which contain the top level directories which the plugin will recursive analyze for class selectors

#### `fileExts`

A comma, delineated string representing file extensions that will be examined for class selectors within `directories`

#### `blacklistedClasses`

An object with two keys (`BLACKLIST_CLASSES` and `BLACKLIST_PREFIXES`) whose values are both an array of strings which are class selectors (including the period!).
These selectors will be ignored (skipped from namespacing) in stylesheets. The selectors in `BLACKLIST_PREFIXES` will ignore class selectors that begin with those strings.

#### `regExps`

An array of strings that represent regular expressions to target specific internal/helper method invocations within a codebase that can be targeted by
the plugin. See 0c645c5 for an example.

## Usage

An [example script](./examples/scss-parser.js) demonstrates how the plugins can be hooked up with PostCSS. If placed in the directory `scripts/node`, the `clean` plugin can be executed with

`node scripts/node/scss-parser.js path/to/stylesheet.scss --clean`

The `analytics` plugin can be run with

`node scripts/node/scss-parser.js path/to/stylesheet.scss --analyze`

## Linting

To check for any dangling namespaced selectors, the following command can be run

`squeaky-lint --directoriesPath <FILE_PATH> --pathRoot <FILE_PATH> --composeDir`

where `directoriesPath` points to a module which returns an array of strings denoting file directories to lint
and `pathRoot` is a file path that's the top level directory of the code to be analyzed
with `composeDir` being a comma delineated string of the directories that have stylesheets implementing CSS composition
then `ext` can be used with a comma delineated string to specify the extensions for view files to scan for squeaky selectors

## Statistics

There are two auxiliary plugins that help collect data to assist with the movement between the squeaky phases

### `analytics` plugin

After a stylesheet has been namespaced (run through phase 1, the `clean` plugin), it can be checked for how "clean" the stylesheet is relative to the codebase.
This is determined by checking the base/original (without the suffix) selector and seeing if all occurrences of that selector have been converted
to CSS modules. This is done by checking if the selector processed in the current stylesheet is the only place that still has a namespace. A stylesheet that contains
only namespaced selectors that are present in the current stylesheet means that it's selectors have been completely isolated to a file.

The plugin takes the following options:

#### `scssSheets`

A newline separated string of SCSS files. This typically is the result of a Shell command (such as `find`) to aggregate necessary files

## Development

`yarn test` will run the specs, `yarn lint` will run `eslint` with the `airbnb` configuration

Specs can be debugged with `node --inspect-brk node_modules/jasmine/bin/jasmine.js specs/**/*.js`
