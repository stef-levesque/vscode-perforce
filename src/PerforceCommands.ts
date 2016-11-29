'use strict';

import {
    commands,
    workspace,
    window,
    Uri
} from 'vscode';

import * as Path from 'path';

import {PerforceService} from './PerforceService';
import {Display} from './Display';
import {Utils} from './Utils';

const perforceServiceCommands: string[] = [
	'add',
    'edit',
    'revert',
    'diff',
    'diffRevision',
    'info',
    'opened'
];

const perforcePluginCommands: string[] = [
	'menuFunctions',
	'showOutput'
];

/**
 * Generate a .editorconfig file in the root of the workspace based on the
 * current vscode settings.
 */
class PerforceCommands 
{

    public dispose() {
    }

    public registerCommands() {
        commands.registerCommand('perforce.add', this.add);
        commands.registerCommand('perforce.edit', this.edit);
        commands.registerCommand('perforce.revert', this.revert);
        commands.registerCommand('perforce.diff', this.diff);
        commands.registerCommand('perforce.diffRevision', this.diffRevision);
        commands.registerCommand('perforce.info', this.info);
        commands.registerCommand('perforce.opened', this.opened);
        commands.registerCommand('perforce.showOutput', this.showOutput);
        commands.registerCommand('perforce.menuFunctions', this.menuFunctions);
    }

    public add() {
        var editor = window.activeTextEditor;
        if(!this.checkFileSelected()) {
            return false;
        }

        if(!this.checkFolderOpened()) {
            return false;
        }

        PerforceService.execute("add", (err, stdout, stderr) => {
            PerforceService.handleCommonServiceResponse(err, stdout, stderr);
            if(!err) {
                window.setStatusBarMessage("Perforce: file opened for add", 3000);
            }
        }, editor.document.uri.toString());
    }

    public edit() {
        var editor = window.activeTextEditor;
        if(!this.checkFileSelected()) {
            return false;
        }

        if(!this.checkFolderOpened()) {
            return false;
        }

        PerforceService.execute("edit", (err, stdout, stderr) => {
            PerforceService.handleCommonServiceResponse(err, stdout, stderr);
            if(!err) {
                window.setStatusBarMessage("Perforce: file opened for edit", 3000);
            }
        }, editor.document.uri.toString());
    }

    public revert() {
        var editor = window.activeTextEditor;
        if(!this.checkFileSelected()) {
            return false;
        }

        if(!this.checkFolderOpened()) {
            return false;
        }

        PerforceService.execute("revert", (err, stdout, stderr) => {
            PerforceService.handleCommonServiceResponse(err, stdout, stderr);
            if(!err) {
                window.setStatusBarMessage("Perforce: file reverted", 3000);
            }
        }, editor.document.uri.toString());
    }

    public diff(revision?: number) {
                var editor = window.activeTextEditor;
        if(!this.checkFileSelected()) {
            return false;
        }

        if(!this.checkFolderOpened()) {
            return false;
        }

        var doc = editor.document;

        if(!doc.isUntitled) {
            Utils.getFile(doc.uri.fsPath, revision).then((tmpFile: string) => {
                var tmpFileUri = Uri.file(tmpFile)
                var revisionLabel = isNaN(revision) ? 'Most Recent Revision' : `Revision #${revision}`;
                commands.executeCommand('vscode.diff', tmpFileUri, doc.uri, Path.basename(doc.uri.fsPath) + ' - Diff Against ' + revisionLabel);
            }, (err) => {
                Display.showError(err.toString());
            })
        }
    }

    public diffRevision() {
        window.showInputBox({prompt: 'What revision would you like to diff?'})
            .then(val => this.diff(parseInt(val)));
    }

    public info() {
        if(!this.checkFolderOpened()) {
            return false;
        }

        PerforceService.execute('info', PerforceService.handleCommonServiceResponse);
    }

    public opened() {
        if(!this.checkFolderOpened()) {
            return false;
        }

        PerforceService.execute('opened', (err, stdout, stderr) => {
            if(err){
                Display.showError(err.message);
            } else if(stderr) {
                Display.showError(stderr.toString());
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
                    this.where(whereFile).then((result) => {
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

    private where(file: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if(!this.checkFolderOpened()) {
                reject();
                return;
            }

            PerforceService.execute('where', (err, stdout, stderr) => {
                if(err){
                    Display.showError(err.message);
                    reject(err);
                } else if(stderr) {
                    Display.showError(stderr.toString());
                    reject(stderr);
                } else {
                    resolve(stdout.toString());
                }
            });
        });
    }

    public showOutput() {

    }

    public menuFunctions() {
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
                    this.add();
                    break;
                case "edit":
                    this.edit();
                    break;
                case "revert":
                    this.revert();
                    break;
                case "diff":
                    this.diff();
                    break;
                case "diffRevision":
                    this.diffRevision();
                    break;
                case "info":
                    this.info();
                    break;
                case "opened":
                    this.opened();
                    break;
                default:
                    break;
            }
        });
    }

    private checkFileSelected() {
        if(!window.activeTextEditor) {
            window.setStatusBarMessage("Perforce: No file selected", 3000);
            return false;
        }

        return true;
    }

    private checkFolderOpened() {
        if (workspace.rootPath == undefined) {
            window.setStatusBarMessage("Perforce: No folder selected", 3000);
            return false;
        }

        return true;
    }
}

export default PerforceCommands;