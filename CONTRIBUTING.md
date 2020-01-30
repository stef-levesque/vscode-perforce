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

Note that references in the text below to `npm run` can generally be replaced with clicking on the correct button in vscode's `npm scripts` section in the explorer!

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

There are two types of test:

* **Unit tests**, that do not require the vscode API
  * A single run can be started using `npm run unittest`
  * You can also run a watch built that automatically runs the unit tests on every code change with `npm run watchunit`
  * As the majority of files require the vscode API, the number of tests here is relatively small
* **Integration tests**, that require the vscode API and run with a vscode window, using the `vscode-test` package
  * Running the integration tests also includes the unit tests
  * A single run of the integration tests can be started using `npm run integrationtest`, however a launch configuration is provided to run the tests in the debugger. Run the `Launch Extension` configuration and it will compile the typescript and open up vscode to run the tests (using the `vscode-test` package).
  * You should leave the window alone while the tests run. If run from the debugger, the results will appear in the DEBUG CONSOLE view.
  * You can run a watch build of the integration tests using `watchintegration-linux`
    * This requires a display server, e.g. Xvfb running on display 99, and as such only works on linux.
    * To run,
      1. install Xvfb,
      2. start the server, e.g.
         `Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &`
      3. Run `npm run watchintegration-linux`
  * Note that the integration tests stub the perforce command line. There can ocassionally be some 'interference' where error messages appear in the debug log, due to the extension reacting to events / editor windows opened by the test, between tests and after the stub has been destroyed. These can generally be ignored as long as they do not cause test failures and the errors do not show up repeatedly.


Note that all of the tests use tsc directly instead of webpack, as the tests are not included in the webpack build.

When you raise a pull request, the continuous integration job will run `npm run test`, which does both of the above - so make sure these pass before raising the pull request.





