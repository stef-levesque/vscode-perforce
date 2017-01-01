# vscode-perforce

[![GitHub issues](https://img.shields.io/github/issues/stef-levesque/vscode-perforce.svg)](https://github.com/stef-levesque/vscode-perforce/issues)
[![Dependency Status](https://img.shields.io/david/stef-levesque/vscode-perforce.svg)](https://david-dm.org/stef-levesque/vscode-perforce#info=dependencies)  
[![Dev Dependency Status](https://img.shields.io/david/dev/stef-levesque/vscode-perforce.svg)](https://david-dm.org/stef-levesque/vscode-perforce#info=devDependencies)  
[![GitHub license button](https://img.shields.io/github/license/stef-levesque/vscode-perforce.svg)](https://github.com/stef-levesque/vscode-perforce/blob/master/LICENSE.md)
[![VS Code marketplace button](http://vsmarketplacebadge.apphb.com/installs/slevesque.perforce.svg)](https://marketplace.visualstudio.com/items/slevesque.perforce)
[![Gitter chat button](https://img.shields.io/gitter/room/stef-levesque/vscode-perforce.svg)](https://gitter.im/stef-levesque/vscode-perforce)

Perforce integration for Visual Studio Code

## Commands

* `add` - Open a new file to add it to the depot
* `edit` - Open an existing file for edit
* `revert` - Discard changes from an opened file
* `diff` - Display diff of client file with depot file
* `diff revision` - Display diff of client file with depot file at a specific revision
* `info` - Display client/server information

## Status bar icons

* ![check](https://cdn.rawgit.com/github/octicons/master/lib/svg/check.svg) opened in add or edit
* ![file-text](https://cdn.rawgit.com/github/octicons/master/lib/svg/file-text.svg) not opened on this client
* ![circle-slash](https://cdn.rawgit.com/github/octicons/master/lib/svg/circle-slash.svg) not under client's root

## Installation

Simply copy the files to your vscode **extensions** folder
* **Windows** `%USERPROFILE%\.vscode\extensions`
* **Mac** `$HOME/.vscode/extensions`
* **Linux** `$HOME/.vscode/extensions`

## Contributing

1. Fork it!
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request :D

## Requirements

Visual Studio Code v0.10.x (November 2015)

## Credits

* [Visual Studio Code](https://code.visualstudio.com/)
* [vscode-docs on GitHub](https://github.com/Microsoft/vscode-docs)

## License

[MIT](LICENSE.md)

---

## Change log

### [0.1.9] - 2016-09-23

* Fix issue #23 - error with `diff` keyboard shortcut

### [0.1.8] - 2016-07-11

* Add ability to configure the p4 client per workspace. (#19, thanks @ralberts)
* Add ability to diff specific revisions (#20, thanks @hoovercj)
* Add ability to see files opened in perforce and open one in the editor (#21, thanks @hoovercj)

### [0.1.7] - 2016-05-11

* the perforce command path can be configured in settings (#15, thanks @hoovercj)

### [0.1.6] - 2016-03-31

* Fix a temporary file issue on Windows

### [0.1.5] - 2016-03-30

* Show diff in a compare window
* Fix issue #10 - change warning boxes for status bar messages

### [0.1.4] - 2016-01-21

* Fix issue #9 - check for a valid p4 root before running automatic commands

### [0.1.3] - 2015-12-21

* status bar icons
* options to run `add`,`edit`,`delete` on file operations (thanks @jel-massih)

### [0.1.2] - 2015-11-18

* `info` to display client/server information
* Fix issue #2 - set open folder as working directory for `p4` commands

### [0.1.1] - 2015-11-15

* activationEvents (thanks @egamma)
* QuickPick on cancel

### [0.1.0] - 2015-11-14

* MIT License
* new icon
* vscode API 0.10.x

### [0.0.3] - 2015-10-18

* group commands in QuickPick

### [0.0.2] - 2015-10-18

* `add` command on a new file
* `diff` current file in output log
* icon

### [0.0.1] - 2015-10-18

* `edit` command on opened file
* `revert` command on opened file

[0.1.9]: https://github.com/stef-levesque/vscode-perforce/compare/62008b25044c90cc382c2cc952e454591af78b47...c584470fe7a1328be3895c49242e543a3ed06d3c
[0.1.8]: https://github.com/stef-levesque/vscode-perforce/compare/2af4e1713633c96ed70ee8366fd533094377ef55...2da50c202f9c711a3b5e6e40d7333bf71cac1f90
[0.1.7]: https://github.com/stef-levesque/vscode-perforce/compare/cf189871bdc013e4342d5c3fd0ee485ddae4734e...1fbce841c7f52f65a00f1c25bc530b8c4296aafe
[0.1.6]: https://github.com/stef-levesque/vscode-perforce/compare/2915c7688d1c71dd1815350313f7d4344cab1607...b9bb4076beb62d47d17abfd8fc515058ab9f5adb
[0.1.5]: https://github.com/stef-levesque/vscode-perforce/compare/383da5048e342cbbe90ab4f74fecd0db9e3d85fc...faad0b0db08d87f04664dfa9bc8a3be3640c6311
[0.1.4]: https://github.com/stef-levesque/vscode-perforce/compare/168cd653195f33774f8c6c795ab29adba4bbe499...d07a5c45df1db65cf0335b5949a55077b84fe4b4
[0.1.3]: https://github.com/stef-levesque/vscode-perforce/compare/1e006e1c51640756b6e6cbd39a78d050e13f5f6a...168cd653195f33774f8c6c795ab29adba4bbe499
[0.1.2]: https://github.com/stef-levesque/vscode-perforce/compare/ada0c5a47eb39fd05cbd3d45433cd351f759f072...1e006e1c51640756b6e6cbd39a78d050e13f5f6a
[0.1.1]: https://github.com/stef-levesque/vscode-perforce/compare/afbe80a4549dad0f45410ab48ab3cf7e59497286...ada0c5a47eb39fd05cbd3d45433cd351f759f072
[0.1.0]: https://github.com/stef-levesque/vscode-perforce/compare/cc98c00da2aac4771f2c6923eb7d8dd968a0aa92...afbe80a4549dad0f45410ab48ab3cf7e59497286
[0.0.3]: https://github.com/stef-levesque/vscode-perforce/compare/d088f2844785e3c607a55e6a165f76e0179dc4c2...cc98c00da2aac4771f2c6923eb7d8dd968a0aa92
[0.0.2]: https://github.com/stef-levesque/vscode-perforce/compare/ec31157dee778c7a59cf86b7382f1d8a5c152736...d088f2844785e3c607a55e6a165f76e0179dc4c2
[0.0.1]: https://github.com/stef-levesque/vscode-perforce/commit/ec31157dee778c7a59cf86b7382f1d8a5c152736
=======
# vscode-perforce

[![GitHub issues](https://img.shields.io/github/issues/stef-levesque/vscode-perforce.svg)](https://github.com/stef-levesque/vscode-perforce/issues)
[![Dependency Status](https://img.shields.io/david/stef-levesque/vscode-perforce.svg)](https://david-dm.org/stef-levesque/vscode-perforce#info=dependencies)  
[![Dev Dependency Status](https://img.shields.io/david/dev/stef-levesque/vscode-perforce.svg)](https://david-dm.org/stef-levesque/vscode-perforce#info=devDependencies)  
[![GitHub license button](https://img.shields.io/github/license/stef-levesque/vscode-perforce.svg)](https://github.com/stef-levesque/vscode-perforce/blob/master/LICENSE.md)
[![VS Code marketplace button](http://vsmarketplacebadge.apphb.com/installs/slevesque.perforce.svg)](https://marketplace.visualstudio.com/items/slevesque.perforce)
[![Gitter chat button](https://img.shields.io/gitter/room/stef-levesque/vscode-perforce.svg)](https://gitter.im/stef-levesque/vscode-perforce)

Perforce integration for Visual Studio Code

## Commands

* `add` - Open a new file to add it to the depot
* `edit` - Open an existing file for edit
* `revert` - Discard changes from an opened file
* `diff` - Display diff of client file with depot file
* `diff revision` - Display diff of client file with depot file at a specific revision
* `info` - Display client/server information

## Status bar icons

* ![check](https://cdn.rawgit.com/github/octicons/master/svg/check.svg) opened in add or edit
* ![file-text](https://cdn.rawgit.com/github/octicons/master/svg/file-text.svg) not opened on this client
* ![circle-slash](https://cdn.rawgit.com/github/octicons/master/svg/circle-slash.svg) not under client's root

## Installation

Simply copy the files to your vscode **extensions** folder
* **Windows** `%USERPROFILE%\.vscode\extensions`
* **Mac** `$HOME/.vscode/extensions`
* **Linux** `$HOME/.vscode/extensions`

## Contributing

1. Fork it!
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request :D

## Requirements

Visual Studio Code v0.10.x (November 2015)

## Credits

* [Visual Studio Code](https://code.visualstudio.com/)
* [vscode-docs on GitHub](https://github.com/Microsoft/vscode-docs)

## License

[MIT](LICENSE.md)

---

## Change log

### [0.1.9] - 2016-09-23

* Fix issue #23 - error with `diff` keyboard shortcut

### [0.1.8] - 2016-07-11

* Add ability to configure the p4 client per workspace. (#19, thanks @ralberts)
* Add ability to diff specific revisions (#20, thanks @hoovercj)
* Add ability to see files opened in perforce and open one in the editor (#21, thanks @hoovercj)

### [0.1.7] - 2016-05-11

* the perforce command path can be configured in settings (#15, thanks @hoovercj)

### [0.1.6] - 2016-03-31

* Fix a temporary file issue on Windows

### [0.1.5] - 2016-03-30

* Show diff in a compare window
* Fix issue #10 - change warning boxes for status bar messages

### [0.1.4] - 2016-01-21

* Fix issue #9 - check for a valid p4 root before running automatic commands

### [0.1.3] - 2015-12-21

* status bar icons
* options to run `add`,`edit`,`delete` on file operations (thanks @jel-massih)

### [0.1.2] - 2015-11-18

* `info` to display client/server information
* Fix issue #2 - set open folder as working directory for `p4` commands

### [0.1.1] - 2015-11-15

* activationEvents (thanks @egamma)
* QuickPick on cancel

### [0.1.0] - 2015-11-14

* MIT License
* new icon
* vscode API 0.10.x

### [0.0.3] - 2015-10-18

* group commands in QuickPick

### [0.0.2] - 2015-10-18

* `add` command on a new file
* `diff` current file in output log
* icon

### [0.0.1] - 2015-10-18

* `edit` command on opened file
* `revert` command on opened file

[0.1.9]: https://github.com/stef-levesque/vscode-perforce/compare/62008b25044c90cc382c2cc952e454591af78b47...c584470fe7a1328be3895c49242e543a3ed06d3c
[0.1.8]: https://github.com/stef-levesque/vscode-perforce/compare/2af4e1713633c96ed70ee8366fd533094377ef55...2da50c202f9c711a3b5e6e40d7333bf71cac1f90
[0.1.7]: https://github.com/stef-levesque/vscode-perforce/compare/cf189871bdc013e4342d5c3fd0ee485ddae4734e...1fbce841c7f52f65a00f1c25bc530b8c4296aafe
[0.1.6]: https://github.com/stef-levesque/vscode-perforce/compare/2915c7688d1c71dd1815350313f7d4344cab1607...b9bb4076beb62d47d17abfd8fc515058ab9f5adb
[0.1.5]: https://github.com/stef-levesque/vscode-perforce/compare/383da5048e342cbbe90ab4f74fecd0db9e3d85fc...faad0b0db08d87f04664dfa9bc8a3be3640c6311
[0.1.4]: https://github.com/stef-levesque/vscode-perforce/compare/168cd653195f33774f8c6c795ab29adba4bbe499...d07a5c45df1db65cf0335b5949a55077b84fe4b4
[0.1.3]: https://github.com/stef-levesque/vscode-perforce/compare/1e006e1c51640756b6e6cbd39a78d050e13f5f6a...168cd653195f33774f8c6c795ab29adba4bbe499
[0.1.2]: https://github.com/stef-levesque/vscode-perforce/compare/ada0c5a47eb39fd05cbd3d45433cd351f759f072...1e006e1c51640756b6e6cbd39a78d050e13f5f6a
[0.1.1]: https://github.com/stef-levesque/vscode-perforce/compare/afbe80a4549dad0f45410ab48ab3cf7e59497286...ada0c5a47eb39fd05cbd3d45433cd351f759f072
[0.1.0]: https://github.com/stef-levesque/vscode-perforce/compare/cc98c00da2aac4771f2c6923eb7d8dd968a0aa92...afbe80a4549dad0f45410ab48ab3cf7e59497286
[0.0.3]: https://github.com/stef-levesque/vscode-perforce/compare/d088f2844785e3c607a55e6a165f76e0179dc4c2...cc98c00da2aac4771f2c6923eb7d8dd968a0aa92
[0.0.2]: https://github.com/stef-levesque/vscode-perforce/compare/ec31157dee778c7a59cf86b7382f1d8a5c152736...d088f2844785e3c607a55e6a165f76e0179dc4c2
[0.0.1]: https://github.com/stef-levesque/vscode-perforce/commit/ec31157dee778c7a59cf86b7382f1d8a5c152736
