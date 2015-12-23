# vscode-perforce

[![GitHub issues](https://img.shields.io/github/issues/stef-levesque/vscode-perforce.svg)](https://github.com/stef-levesque/vscode-perforce/issues)
[![Dev Dependency Status](https://img.shields.io/david/dev/stef-levesque/vscode-perforce.svg)](https://david-dm.org/stef-levesque/vscode-perforce#info=devDependencies)<br>
[![GitHub license button](https://img.shields.io/github/license/stef-levesque/vscode-perforce.svg)](https://github.com/stef-levesque/vscode-perforce/blob/master/LICENSE.md)
[![VS Code marketplace button](https://img.shields.io/badge/VS%20Code-%3E150-5c2d91.svg)](https://marketplace.visualstudio.com/items/slevesque.perforce)
[![Gitter chat button](https://img.shields.io/gitter/room/stef-levesque/vscode-perforce.svg)](https://gitter.im/stef-levesque/vscode-perforce)

Perforce integration for Visual Studio Code

## Commands
* `add` - Open a new file to add it to the depot
* `edit` - Open an existing file for edit
* `revert` - Discard changes from an opened file
* `diff` - Display diff of client file with depot file
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
