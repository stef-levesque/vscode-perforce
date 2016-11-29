var vscode = require('vscode');
var CP = require('child_process');
var Path = require('path');
var window = vscode.window;
var workspace = vscode.workspace;
var Uri = vscode.Uri;

var isWin = /^win/.test(process.platform);
var _channel = window.createOutputChannel('Perforce Log');
var _statusBarItem = null;

var _subscriptions = [];
var _watcher = null;

//Used for editOnFileModified, to cache file until a new file modified
var _lastCheckedFilePath = null;

function activate() {
	_channel.appendLine("Perforce Log Output");

	vscode.commands.registerCommand('perforce.showOutput', p_showOutput);
	vscode.commands.registerCommand('perforce.add', p_add);
	vscode.commands.registerCommand('perforce.edit', p_edit);
	vscode.commands.registerCommand('perforce.revert', p_revert);
	vscode.commands.registerCommand('perforce.diff', p_diff);
	vscode.commands.registerCommand('perforce.diffRevision', p_diffRevision);
	vscode.commands.registerCommand('perforce.info', p_info);
	vscode.commands.registerCommand('perforce.menuFunctions', p_menuFunction);
	vscode.commands.registerCommand('perforce.opened', p_opened);

	w_onChangeEditor();
	window.onDidChangeActiveTextEditor(w_onChangeEditor, this, _subscriptions);

	var config = workspace.getConfiguration('perforce');

	if(config) {
		fileInClientRoot(workspace.rootPath, function() {

			if(config.editOnFileSave) {
				workspace.onWillSaveTextDocument(e => {
                    e.waitUntil(w_onWillSaveFile(e.document));
                }, this, _subscriptions);
			}

			if(config.editOnFileModified) {
				workspace.onDidChangeTextDocument(w_onFileModified, this, _subscriptions);
			}

			if(config.deleteOnFileDelete || config.addOnFileCreate) {
				_watcher = workspace.createFileSystemWatcher('**/*.*', false, true, false);

				if(config.deleteOnFileDelete) {
					_watcher.onDidDelete(w_onFileDeleted);
				}

				if(config.addOnFileCreate) {
					_watcher.onDidCreate(w_onFileCreated);
				}
			}
		});
	}
}
exports.activate = activate;

function surroundByDoubleQuotes(path) {
	return "\"" + path + "\""
}

function pathIsUNC(path) {
	return path.indexOf('\\\\') == 0;
}

function normalizePath(path) {
	var normalizedPath = path;

	if (!pathIsUNC(normalizedPath)) {
		var replaceable = normalizedPath.split('\\');
		normalizedPath = replaceable.join('\\\\');
	}

	normalizedPath = surroundByDoubleQuotes(normalizedPath);
	return normalizedPath;
}

function buildCmdline(command, args) {
	var p4Path = vscode.workspace.getConfiguration('perforce').get('command', 'none');
	var p4Client = vscode.workspace.getConfiguration('perforce').get('client', 'none');
	if (p4Path == 'none') {
		p4Path = isWin ? 'p4.exe' : 'p4';
	} else {
		p4Path = normalizePath(p4Path);
	}

	if (p4Client !== 'none') {
		p4Path += ' -c ' + p4Client;
	}

	var cmdline = p4Path + " " + command;

	if (args != undefined)
		cmdline += " " + args;

	return cmdline;
}

function getFile(localFilePath, revision) {

	return new Promise((resolve, reject) => {
		var ext = Path.extname(localFilePath);
		var tmp = require("tmp");
		var tmpFilePath = tmp.tmpNameSync({ postfix: ext });
		revision = isNaN(revision) ? '' : `#${revision}`;
		var cmdline = buildCmdline("print", '-q -o "' + tmpFilePath + '" "' + localFilePath + revision + '"');
		CP.exec(cmdline, {cwd: workspace.rootPath}, function (err, stdout, stderr) {
			if(err){
				reject(err);
			} else if (stderr) {
				reject(stderr);
			} else {
				resolve(tmpFilePath);
			}
		});
	});
}

function checkFolderOpened() {
	if (workspace.rootPath == undefined){
		window.setStatusBarMessage("Multiclip: Nothing to paste", 3000);
		return false;
	}

	return true;
}

function checkFileSelected() {
	var editor = window.activeTextEditor;
	if (!editor) {
		window.setStatusBarMessage("Perforce: No file selected", 3000);
		return false;
	}

	return true;
}

function p_showOutput() {
	_channel.show();
}

function p_add() {
	var editor = window.activeTextEditor;
	if (!checkFileSelected()) {
		return false;
	}

	if(!checkFolderOpened()) {
		return false;
	}

	var uri = editor.document.uri;
	p_addUri(uri);
}

function p_addUri(uri) {
	var cmdline = buildCmdline("add", '"' + uri.fsPath + '"');

	_channel.appendLine(cmdline);
	CP.exec(cmdline, {cwd: workspace.rootPath}, function (err, stdout, stderr) {
		if(err){
			_channel.show();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
		}
		else {
			window.setStatusBarMessage("Perforce: file opened for add", 3000);
			_channel.append(stdout.toString());
			w_onChangeEditor();
		}
	});
}

function p_edit() {
	var editor = window.activeTextEditor;
	if (!checkFileSelected()) {
		return false;
	}
	if(!checkFolderOpened()) {
		return false;
	}

	p_editUri(editor.document.uri);
}

function p_editUri(uri, onSuccess, onError) {
	var cmdline = buildCmdline("edit", '"' + uri.fsPath + '"');

	_channel.appendLine(cmdline);
	CP.exec(cmdline, {cwd: workspace.rootPath}, function (err, stdout, stderr) {
		if(err){
			_channel.show();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
			if (typeof onError=="function") onError();
		}
		else {
			window.setStatusBarMessage("Perforce: file opened for edit", 3000);
			_channel.append(stdout.toString());
			w_onChangeEditor();
			if (typeof onSuccess=="function") onSuccess();
		}
	});
}

function p_revert() {
	var editor = window.activeTextEditor;
	if (!checkFileSelected()) {
		return false;
	}
	if(!checkFolderOpened()) {
		return false;
	}
	var uri = editor.document.uri;
	var cmdline = buildCmdline("revert", '"' + uri.fsPath + '"');

	_channel.appendLine(cmdline);
	CP.exec(cmdline, {cwd: workspace.rootPath}, function (err, stdout, stderr) {
		if(err){
			_channel.show();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
		}
		else {
			window.setStatusBarMessage("Perforce: file reverted", 3000);
			_channel.append(stdout.toString());
			w_onChangeEditor();
		}
	});
}

function p_diff(revision) {
	var editor = window.activeTextEditor;
	if (!checkFileSelected()) {
		return false;
	}
	if(!checkFolderOpened()) {
		return false;
	}
	var doc = editor.document;

	if (!doc.isUntitled) {
		getFile(doc.uri.fsPath, revision).then( (tmpFile) => {
			var tmpFileUri = vscode.Uri.file(tmpFile);
			var revisionLabel = isNaN(revision) ?  'Most Recent Revision' : `Revision #${revision}`;
			vscode.commands.executeCommand("vscode.diff", tmpFileUri, doc.uri, Path.basename(doc.uri.fsPath) + " - Diff Against " + revisionLabel);
		}, (err) => {
			_channel.show();
			_channel.appendLine("ERROR:");
			_channel.append(err.toString());
		});
	}
}

function p_diffRevision() {
	window.showInputBox({prompt: 'What revision would you like to diff?'})
		.then(val => p_diff(val));
}

function p_info() {
	var cmdline = buildCmdline("info");

	if(!checkFolderOpened()) {
		return false;
	}

	_channel.appendLine(cmdline);
	CP.exec(cmdline, {cwd:workspace.rootPath}, function (err, stdout, stderr) {
		if(err){
			_channel.show();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
		}
		else {
			_channel.show();
			_channel.append(stdout.toString());
		}
	});
}

function p_opened() {
	var cmdline = buildCmdline("opened");

	if(!checkFolderOpened()) {
		return false;
	}

	_channel.appendLine(cmdline);
	CP.exec(cmdline, {cwd:workspace.rootPath}, function (err, stdout, stderr) {
		if(err){
			_channel.show();
			_channel.appendLine("ERROR:");
			_channel.append(err.toString());
		} else if(stderr) {
			_channel.show();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
			reject(stderr);
		} else {
			var opened = stdout.toString().trim().split('\n')
			if (opened.length === 0) {
				return false;
			}
			
			var options = opened.map((file) => {
				return {
					description: file,
					label: Path.basename(file)
				}
			});

			window.showQuickPick(options, {matchOnDescription: true}).then(selection => {
				if (!selection) {
					return false;
				}

				let depotPath = selection.description;
				var whereFile = depotPath.substring(0, depotPath.indexOf('#'));
				p_where(whereFile).then((result) => {
					// https://www.perforce.com/perforce/r14.2/manuals/cmdref/p4_where.html
					var results = result.split(' ');
					if (results.length >= 3) {
						var fileToOpen = results[2].trim();
						workspace.openTextDocument(Uri.file(fileToOpen)).then((document) => {
							window.showTextDocument(document);
						});
					}
				});
			});
		}
	});
}

function p_where(file) {
	return new Promise((resolve, reject) => {
		var cmdline = buildCmdline("where", file);

		if(!checkFolderOpened()) {
			reject();
		}

		_channel.appendLine(cmdline);
		CP.exec(cmdline, {cwd:workspace.rootPath}, (err, stdout, stderr) => {
			if(err){
				_channel.show();
				_channel.appendLine("ERROR:");
				_channel.append(err.toString());
				reject(err);
			} else if(stderr) {
				_channel.show();
				_channel.appendLine("ERROR:");
				_channel.append(stderr.toString());
				reject(stderr);
			} else {
				resolve(stdout.toString());
			}
		});
	})
}

function p_deleteUri(uri) {
	var cmdline = buildCmdline("delete", '"' + uri.fsPath + '"');

	_channel.appendLine(cmdline);
	CP.exec(cmdline, {cwd: workspace.rootPath}, function (err, stdout, stderr) {
		if(err){
			_channel.show();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
		}
		else {
			window.setStatusBarMessage("Perforce: file marked for delete", 3000);
			_channel.append(stdout.toString());
		}
	});
}

function p_menuFunction() {
	var items = [];
	items.push({ label: "add", description: "Open a new file to add it to the depot" });
	items.push({ label: "edit", description: "Open an existing file for edit" });
	items.push({ label: "revert", description: "Discard changes from an opened file" });
	items.push({ label: "diff", description: "Display diff of client file with depot file" });
	items.push({ label: "diffRevision", description: "Display diff of client file with depot file at a specific revision" });
	items.push({ label: "info", description: "Display client/server information" });
	items.push({ label: "opened", description: "View 'open' files and open one in editor" });
	window.showQuickPick(items, {matchOnDescription: true, placeHolder: "Choose a Perforce command:"}).then(function (selection) {
		if(selection == undefined)
			return;
		switch (selection.label) {
			case "add":
				p_add();
				break;
			case "edit":
				p_edit();
				break;
			case "revert":
				p_revert();
				break;
			case "diff":
				p_diff();
				break;
			case "diffRevision":
				p_diffRevision();
				break;
			case "info":
				p_info();
				break;
			case "opened":
				p_opened();
				break;
			default:
				break;
		}
	});
}

function p_checkFileNotOpened(uri, onNotOpened, onOpened, onError) {
	var cmdline = buildCmdline("opened", '"' + uri.fsPath + '"');

	_channel.appendLine(cmdline);
	CP.exec(cmdline, {cwd: workspace.rootPath}, function (err, stdout, stderr) {
		if(err){
			_channel.show();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
			if (typeof onError=="function") onError();
		}
		else {
			//stderr set if not opened
			if(stderr) {
				if (typeof onNotOpened=="function") onNotOpened(uri);
			} else {
				if (typeof onOpened=="function") onOpened();
			}
			_channel.append(stdout.toString());
		}
	});

	return true;
}

function p_getClientRoot(onSuccess, onFailure) {
	var cmdline = buildCmdline("info");

	if (!checkFolderOpened()){
		return false;
	}

	_channel.appendLine(cmdline);
	CP.exec(cmdline, {cwd: workspace.rootPath}, function (err, stdout, stderr) {
		if(err){
			// _channel.show();
			// _channel.appendLine("ERROR:");
			// _channel.append(stderr.toString());
			if (typeof onFailure=="function") onFailure();
		}
		else {
			var stdoutString = stdout.toString();
			// _channel.append(stdoutString);

			var clientRootIndex = stdoutString.indexOf('Client root: ');
			if(clientRootIndex === -1) {
				// _channel.appendLine("ERROR: P4 Info didn't specify a valid Client Root path");
				if (typeof onFailure=="function") onFailure();
				return -1;
			}

			//Set index to after 'Client Root: '
			clientRootIndex += 'Client root: '.length;
			var endClientRootIndex = stdoutString.indexOf('\n', clientRootIndex);
			if(endClientRootIndex === -1) {
				// _channel.appendLine("ERROR: P4 Info Client Root path contains unexpected format");
				// _channel.show();
				if (typeof onFailure=="function") onFailure();
				return -1;
			}

			if (typeof onSuccess=="function") {
				//call onSuccess with path as arg
				onSuccess(stdoutString.substring(clientRootIndex, endClientRootIndex));
			}
		}
	});

	return true;
}

function fileInClientRoot(path, onSuccess, onFailure) {
	p_getClientRoot(function(clientRoot) {
		//Convert to lower and Strip newlines from paths
		clientRoot = clientRoot.toLowerCase().replace(/(\r\n|\n|\r)/gm,"");
		var filePath = path.toLowerCase().replace(/(\r\n|\n|\r)/gm,"");

		//Check if p4 Client Root is in uri's path
		if(filePath.indexOf(clientRoot) !== -1) {
			if (typeof onSuccess=="function") onSuccess();
		} else {
			if (typeof onFailure=="function") onFailure();
		}
	}, onFailure);
}

//Return a Thenable so that we complete `edit` command on file before saving when trying to save.
function tryEditFile(uri) {
	return new Promise((onFulfill, onReject) => {
		if (!checkFolderOpened()){
			onFulfill();
			return false;
		}
		//The callbacks make me cry at night :(
		fileInClientRoot(uri.fsPath, function() {
			// onSuccess
			p_checkFileNotOpened(uri, function(uri) {
				p_editUri(uri, function() {
					onFulfill();		
				}, function() {
					onFulfill();		
				});
			}, function() {
				onFulfill();		
			}, function() {
				onFulfill();		
			});
		}, function() {
			// onFailure
			window.setStatusBarMessage("Perforce: File not in P4 Client Root", 3000);
			onFulfill();		
		});
	});
}

function w_onWillSaveFile(doc) {
	return tryEditFile(doc.uri);
}

function w_onFileModified(docChange) {
	//If this doc has already been checked, then just return
	if(docChange.document.uri.fsPath == _lastCheckedFilePath) {
		return;
	}

	//If this doc is not the active file, return
	var editor = window.activeTextEditor;
	if (!editor || !editor.document || editor.document.uri.fsPath != docChange.document.uri.fsPath) {
		return;
	}

	_lastCheckedFilePath = docChange.document.uri.fsPath;
	//tryEditFile returns a thenable so we need to resolve it.
	Promise.resolve(tryEditFile(docChange.document.uri));
}

function w_onFileDeleted(uri) {
	if (!checkFolderOpened()){
		return false;
	}

	p_deleteUri(uri);
}

function w_onFileCreated(uri) {
	if (!checkFolderOpened()){
		return false;
	}

	var editor = window.activeTextEditor;
	//Only add files open in text editor
	if(editor.document && editor.document.uri.fsPath == uri.fsPath) {
		p_addUri(uri);
	}
}

function w_onChangeEditor() {
	// Create as needed
	if (!_statusBarItem) {
		_statusBarItem = window.createStatusBarItem(vscode.StatusBarAlignment.Left);
		_statusBarItem.command = 'perforce.menuFunctions';
	}

	// Get the current text editor
	var editor = window.activeTextEditor;
	if (!editor) {
		_statusBarItem.hide();
		return;
	}

	var doc = editor.document;

	// Only update status if an MD file
	if (!doc.isUntitled) {
		var cmdline = buildCmdline("opened", '"' + doc.uri.fsPath + '"');
		CP.exec(cmdline, {cwd: workspace.rootPath}, function (err, stdout, stderr) {
			if(err){
				// file is not under client's root ...
				_statusBarItem.text = 'P4: $(circle-slash)';
				_statusBarItem.tooltip = stderr.toString();
			}
			else if(stderr) {
				// file not opened on this client.
				_statusBarItem.text = 'P4: $(file-text)';
				_statusBarItem.tooltip = stderr.toString();
			} else if(stdout) {
				// file opened in add or edit
				_statusBarItem.text = 'P4: $(check)';
				_statusBarItem.tooltip = stdout.toString();
			}
		});
		_statusBarItem.show();
	} else {
		_statusBarItem.hide();
	}
}