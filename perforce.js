'use strict';

var vscode = require('vscode');
var CP = require('child_process');

var isWin = /^win/.test(process.platform);
var _channel = vscode.window.getOutputChannel('Perforce Log');
var exec = "p4";
if (isWin) {
	exec += ".exe";
}

function activate() {
	_channel.appendLine("Perforce Log Output");

	vscode.commands.registerCommand('perforce.showOutput', p_showOutput);
	vscode.commands.registerCommand('perforce.edit', p_edit);
	vscode.commands.registerCommand('perforce.revert', p_revert);
	
}
exports.activate = activate;

function p_showOutput() {
	_channel.reveal();
}

function p_edit() {
	var command = exec + " edit ";
	var editor = vscode.window.getActiveTextEditor();
	if (!editor) {
		vscode.window.showInformationMessage("Perforce: no file selected");
		return;
	}
	var uri = editor.getTextDocument().getUri();
	command += uri.fsPath;

	_channel.appendLine(command);
	CP.exec(command, function (err, stdout, stderr) {
		if (err) {
			_channel.reveal();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
		}
		else {
			vscode.window.showInformationMessage("Perforce: file opened for edit");
			_channel.append(stdout.toString());
		}
	});
}
function p_revert() {
	var command = exec + " revert ";
	var editor = vscode.window.getActiveTextEditor();
	if (!editor) {
		vscode.window.showInformationMessage("Perforce: no file selected");
		return;
	}
	var uri = editor.getTextDocument().getUri();
	command += uri.fsPath;

	_channel.appendLine(command);
	CP.exec(command, function (err, stdout, stderr) {
		if (err) {
			_channel.reveal();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
		}
		else {
			vscode.window.showInformationMessage("Perforce: file reverted");
			_channel.append(stdout.toString());
		}
	});
}
