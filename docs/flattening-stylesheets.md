# How stylesheets are flattened

Per *phase 2* of squeaky clean room, to obtain consistency between legacy + modern code, styles should be "flat" (single level, without nesting) to match the CSS modules pattern that new world code adopts.

The following breaks down the thought process between how CSS specificity for classes can be reduced. There are explicit references to specific file extensions (such as `ECO` + `ERB`), however the idea applies to any view file template.

## Overview
To do this, a [PostCSS plugin](https://github.com/postcss/postcss-nested) is leveraged to do the hard work of converting nested SCSS stylesheets into logically equivalent CSS stylesheets. This exposes the long selectors present in the codebase which further needs to be broken down into a single squeaky selector. This is where the `flatten` plugin comes into play to intelligently pick out the rightmost (child and most specific bottom) selector to keep specificity low.

To minimize side effects from these stylesheets affecting shared components (since squeaky selectors are on all elements), a `heuristic` plugin was created to determine which files are likely to be the places where a stylesheet is used. This is done by inspecting the stylesheet before it's flattened and analyzing it's nested structure to find the relation between each squeaky selector (the base selector) with styles and using it's closest ancestor squeaky selector to determine where the base selector is actually used. These files are then whitelisted so all other view files are purged of that base selector. This is repeated for each selector along the stylesheet. The end result are the squeaky selectors for a given stylesheet being only present in the views that use it.

## Cleansing algorithm
This _cleansing_ of the styles has two parts associated. The first part is the _inter_ part of cleansing since it ensures isolation of the squeaky styles to a given feature. The second part of the cleansing is _intra_ where a given feature stylesheet has namespaced components which may clash with one another (e.g. date pickers in two different sections of a side panel). File precedence and specificity miss fixing this issue because they resolve to the same specificity and originally only have a single rule applied due to namespace nesting rather than both. The intra cleansing will involve a bottom-up, tree traversal where the same algorithms above will be applied on a leaf node basis so that components within a feature will have squeaky selectors scoped to just the markup that needs it so that when the stylesheet is flattened, collisions will be avoided since only markup within this feature will have the proper associated selectors tied to the element.

An edge case for intra cleansing is when both the base + ancestor selector are located in the same "leaf" (template/markup) file. In that case, due to the uniqueness of each selector and the structure of the markup, the base selector can only be found in files with both and thus the base selector can be removed from all other locations. The current logic handles markup in ECO files, so markup found in other file types (such as ERB) may need manual treatment. That logic is also symmetrical so if only the ancestor file is in an ECO file, additional logic needs to be added to check the parent file to see if the base selector is contained in there.

By the time the stylesheet tree is at it's final steps of the cleaning, it will be analyzing the top level, root nodes of the stylesheet and the combination of all the intra cleansing that have occurred will provide the feature cleaning as described by _inter_ cleansing above.

A caveat of the intracleaning is features that style shared widgets (e.g. side panel sections that reference a shared date range widget with different styles). A React component would solve this by passing down class names, however old Marionette components just reach in and style base off the base selector. This has proven difficult to detect/automate so it will need to be resolved on a manual basis.

## Caveats w/ specificity
Another caveat is style specificity which is lost when the selectors are flattened since there are shared component styles that are still nested which will now override the flattened selectors. While features are slowly flattened, these specificity conflicts will also have to be manually resolved until all features are flattened.

Ways to workaround this have been to detect feature specific styles and make them `!important` since in the grand scheme of styles, they would've been the selectors that would've had highest precedence. The idea is to apply this only to declarations where the base/leaf selector has a squeaky namespace, with some manual exceptions (e.g. side panel section tables, skill level dropdowns).

When all styles are flattened, as part of removing the squeaky
namespaces once extraction has been completed and these selectors are
pulled in the manner that CSS modules are done, these `!important`
modifiers can be removed as well (or if an alternative way to handle
specific shared styles is suggested)

In the instances where the above strategy has issues (due to the highly specified nature of feature styles and how namespaced generic widget styles are), the particular squeaky selector can be added in dynamically from the view itself.

### Workaround
Frequently, this problem manifests itself as a shared template, inheriting a base class four
super classes up. The base class usually declares styles have yet to be squeaky
cleaned and have higher specificity than a single class.

These styles need to only be applied to the template when rendered
under a skill level component so without the ability to pass class names
down (such as in React), so a workaround is to apply the namespaced class manually and
keep it specific to just this component.

The above works great for squeaky feature selectors that are added, however state based squeaky selectors (such as `.active-sqkd-...`) especially if they live in ERB files need to be handled on a manual basis since these usually break the assumed hierarchy imposed with frontend only views and generally lack an explicit dependency for how these shared ERB views (such as navigation tabs) end up being specifically styled in the context of a feature when that view is used across multiple features. These cases are called out as a part of the `extract` plugin.

### Relation to `heuristic` plugin
The `heuristic` script operates by determining the top level squeaky selectors which serve as namespaces for the majority of a given stylesheet. These are linked to view files/templates in the codebase which can have additional dependencies in terms of helper views and sub views given the Backbone/Marionette structure of the codebase. In order to find all possible files, the codebase is traversed with the help of [webpack stats](https://webpack.js.org/api/stats/) to determine the full list of files that need to be whitelisted (since a nested table view is unlikely to appear immediately inlined in the top level layout view which contains the top level selectors).

## Caveats w/ data grids
Another oversight is code that's structured for data grids/tables (such as [`Backgrid`](http://backgridjs.com/)) since the configuration of columns leads to options (such as class names or additional header mark up) specified in subviews (markup that is nested when the HTML is generated) can be placed in a definitions file, though the selector might be located in an isolated header cell file. This offset link leads to some squeaky selectors accidentally removed since it expects the dependency chain to match how the markup should be nested.

One way to workaround this Backgrid issue is to place a comment with the ancestor/parent squeaky selector in the column definitions file that's using it. Doing so establishes the missing hierarchical link so that the leaf squeaky selector will be left in it's original file.

## Resolving specificity issues
Since styles tend to be deeply nested and have multiple selectors (comma separated) from the top level of the file down to specific selectors, the specificity should be retained in case conflicts arise in the future. The `flatten` plugin pulls that off with the same library that the `specificity` plugin leverages to ensure that information is kept intact for potential conflicts in the future.

The flattening can lead to some funky formatting which [`stylelint`](https://stylelint.io/) will nicely address!
