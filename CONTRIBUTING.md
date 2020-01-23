# Contributing

## Quick Overview

To contribute code:

1. Fork the extension
1. Clone your fork
1. Create a branch for your feature or fix: `git checkout -b my-new-feature`
1. Run `npm install` to get the dependencies
1. Write and test your changes
1. Commit your changes
1. Push your branch to your fork: `git push origin my-new-feature`
1. Submit a pull request

For non-trivial changes, it's a good idea to create an issue first to cover the change you would like to make.

## Writing & Testing your Changes

### ESLint, Prettier and Webpack

The project includes [ESLint](https://eslint.org/) and [Prettier](https://prettier.io/) configuration to prevent common mistakes and ensure consistent code formatting. The extension is also built using webpack, and webpack checks that ESLint and Prettier rules are met - if any rules fail, the extension will not compile.

It is strongly recommended to install the [ESLint extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) for vscode, as this will highlight problems as you go.

You can enable auto fix on save in vscode using the following setting:

```
"editor.codeActionsOnSave": {
        "source.fixAll": true
},
```

Alternatively, you can run `npm run eslint-fix` to auto-fix eslint and prettier errors.

### Running the extension in debug mode
A launch configuration is provided to start the extension in debug mode. Run the `Launch Extension` configuration. This starts a webpack watch build. Once it's compiled, VSCode will start up with your extension. You are able to set breakpoints in the code as usual.

Changes in the code will automatically re-compile. Press `ctrl+r` in the extension development host to reload the window with your changes.

### Tests
The original project from which this was forked did not have a test framework, so it is not always straightforward to add tests. If you can, please try to add them.

Test suites are defined in `src/test`

A launch configuration is provided to run the tests. Run the `Launch Extension` configuration and it will compile the typescript and open up vscode to run the tests (using the `vscode-test` package). Note that this uses tsc directly instead of webpack, as the tests are not included in the webpack build.




