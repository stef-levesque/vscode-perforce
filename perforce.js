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
	vscode.commands.registerCommand('perforce.add', p_add);
	vscode.commands.registerCommand('perforce.edit', p_edit);
	vscode.commands.registerCommand('perforce.revert', p_revert);
	vscode.commands.registerCommand('perforce.diff', p_diff);
}
exports.activate = activate;

function buildCmdline(command, args)
{
	var cmdline = "p4";
	if (isWin) {
		cmdline += ".exe";
	}
	
	cmdline += " " + command;
	
	if (args != undefined)
		cmdline += " " + args;
		
	return cmdline;
}

function p_showOutput() {
	_channel.reveal();
}

function p_add() {
	var editor = vscode.window.getActiveTextEditor();
	if (!editor) {
		vscode.window.showInformationMessage("Perforce: no file selected");
		return;
	}
	var uri = editor.getTextDocument().getUri();
	var cmdline = buildCmdline("add", '"' + uri.fsPath + '"');
	
	_channel.appendLine(cmdline);
	CP.exec(cmdline, function (err, stdout, stderr) {
		if(err){
			_channel.reveal();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
		}
		else {
			vscode.window.showInformationMessage("Perforce: file opened for add");
			_channel.append(stdout.toString());
		}
	});
}

function p_edit() {
	var editor = vscode.window.getActiveTextEditor();
	if (!editor) {
		vscode.window.showInformationMessage("Perforce: no file selected");
		return;
	}
	var uri = editor.getTextDocument().getUri();
	var cmdline = buildCmdline("edit", '"' + uri.fsPath + '"');
	
	_channel.appendLine(cmdline);
	CP.exec(cmdline, function (err, stdout, stderr) {
		if(err){
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
	var editor = vscode.window.getActiveTextEditor();
	if (!editor) {
		vscode.window.showInformationMessage("Perforce: no file selected");
		return;
	}
	var uri = editor.getTextDocument().getUri();
	var cmdline = buildCmdline("revert", '"' + uri.fsPath + '"');
	
	_channel.appendLine(cmdline);
	CP.exec(cmdline, function (err, stdout, stderr) {
		if(err){
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

function p_diff() {
	var editor = vscode.window.getActiveTextEditor();
	if (!editor) {
		vscode.window.showInformationMessage("Perforce: no file selected");
		return;
	}
	var uri = editor.getTextDocument().getUri();
	var cmdline = buildCmdline("diff", '"' + uri.fsPath + '"');
	
	//TODO: show in a 'compare' window
	
	_channel.appendLine(cmdline);
	CP.exec(cmdline, function (err, stdout, stderr) {
		if(err){
			_channel.reveal();
			_channel.appendLine("ERROR:");
			_channel.append(stderr.toString());
		}
		else {
			_channel.reveal();
			_channel.append(stdout.toString());
		}
	});
}

