'use strict';

import {
    commands,
    workspace,
    window,
    Uri
} from 'vscode';

import { ThemableDecorationAttachmentRenderOptions, DecorationInstanceRenderOptions, DecorationOptions, OverviewRulerLane, Disposable, ExtensionContext, Range, TextDocument, TextEditor, TextEditorSelectionChangeEvent } from 'vscode';


import * as Path from 'path';
import * as fs from 'fs';

import { PerforceService } from './PerforceService';
import { Display } from './Display';
import { Utils } from './Utils';
import { PerforceSCMProvider } from './ScmProvider';

export namespace PerforceCommands 
{
    export function registerCommands() {
        commands.registerCommand('perforce.add', addOpenFile);
        commands.registerCommand('perforce.edit', editOpenFile);
        commands.registerCommand('perforce.revert', revert);
        commands.registerCommand('perforce.diff', diff);
        commands.registerCommand('perforce.diffRevision', diffRevision);
        commands.registerCommand('perforce.annotate', annotate);
        commands.registerCommand('perforce.info', info);
        commands.registerCommand('perforce.opened', opened);
        commands.registerCommand('perforce.logout', logout);
        commands.registerCommand('perforce.login', login);
        commands.registerCommand('perforce.showOutput', showOutput);
        commands.registerCommand('perforce.menuFunctions', menuFunctions);

        // SCM commands
        commands.registerCommand('perforce.Sync', () => {
            PerforceSCMProvider.Sync();
        });
        commands.registerCommand('perforce.Refresh', () => {
            PerforceSCMProvider.Refresh();
        });
        commands.registerCommand('perforce.openFile', (e) => {
            PerforceSCMProvider.OpenFile(e);
        });
        commands.registerCommand('perforce.openResource', (e) => {
            PerforceSCMProvider.Open(e);
        });
        commands.registerCommand('perforce.submitDefault', () => {
            PerforceSCMProvider.SubmitDefault();
        });
        commands.registerCommand('perforce.processChangelist', () => {
            PerforceSCMProvider.ProcessChangelist();
        });
        commands.registerCommand('perforce.editChangelist', (e) => {
            PerforceSCMProvider.EditChangelist(e);
        });
        commands.registerCommand('perforce.describe', (e) => {
            PerforceSCMProvider.Describe(e);
        });
        commands.registerCommand('perforce.submitChangelist', (e) => {
            PerforceSCMProvider.Submit(e);
        });
        commands.registerCommand('perforce.revertChangelist', (e) => {
            PerforceSCMProvider.Revert(e);
        });
        commands.registerCommand('perforce.shelveunshelve', (e) => {
            PerforceSCMProvider.ShelveOrUnshelve(e);
        });
        commands.registerCommand('perforce.revertFile', (e) => {
            PerforceSCMProvider.Revert(e);
        });
        commands.registerCommand('perforce.reopenFile', (e) => {
            PerforceSCMProvider.ReopenFile(e);
        });
    }

    function addOpenFile() {
        var editor = window.activeTextEditor;
        if(!checkFileSelected()) {
            return false;
        }

        var filePath = editor.document.uri.fsPath;
        if(checkFolderOpened()) {
            add(filePath);
        } else {
            add(filePath, Path.dirname(filePath));
        }
    }

    export function add(filePath: string, directoryOverride?: string) {
        const args = '"' + Utils.expansePath(filePath) + '"';
        PerforceService.execute("add", (err, stdout, stderr) => {
            PerforceService.handleCommonServiceResponse(err, stdout, stderr);
            if(!err) {
                Display.showError("file opened for add");
            }
        }, args, directoryOverride);
    }    

    function editOpenFile() {
        var editor = window.activeTextEditor;
        if(!checkFileSelected()) {
            return false;
        }

        var filePath = editor.document.uri.fsPath; 

        //If folder not opened, run p4 in files folder.
        if(checkFolderOpened()) {
            edit(filePath);
        } else {
            edit(filePath, Path.dirname(filePath));
        }
    }

    export function edit(filePath: string, directoryOverride?: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const args = '"' + Utils.expansePath(filePath) + '"';
            PerforceService.execute("edit", (err, stdout, stderr) => {
                PerforceService.handleCommonServiceResponse(err, stdout, stderr);
                if(!err) {
                    Display.showError("file opened for edit");
                }
                reject(err);
            }, args, directoryOverride);
        });
    }

    export function p4delete(filePath: string) {
        const args = '"' + Utils.expansePath(filePath) + '"';
        PerforceService.execute("delete", (err, stdout, stderr) => {
            PerforceService.handleCommonServiceResponse(err, stdout, stderr);
            if(!err) {
                Display.showError("file marked for delete");
            }
        }, args);
    }

    export function revert() {
        var editor = window.activeTextEditor;
        if(!checkFileSelected()) {
            return false;
        }

        //If folder not opened, overrided p4 directory
        var filePath = editor.document.uri.fsPath;
        var directoryOverride = null;
        if(!checkFolderOpened()) {
            directoryOverride = Path.dirname(filePath);
        }

        const args = '"' + Utils.expansePath(filePath) + '"';
        PerforceService.execute("revert", (err, stdout, stderr) => {
            PerforceService.handleCommonServiceResponse(err, stdout, stderr);
            if(!err) {
                Display.showError("file reverted");
            }
        }, args, directoryOverride);
    }

    export function diff(revision?: number) {
        var editor = window.activeTextEditor;
        if(!checkFileSelected()) {
            return false;
        }

        if(!checkFolderOpened()) {
            return false;
        }

        var doc = editor.document;

        if(!doc.isUntitled) {
            Utils.getFile('print', doc.uri.fsPath, revision).then((tmpFile: string) => {
                var tmpFileUri = Uri.file(tmpFile)
                var revisionLabel = isNaN(revision) ? 'Most Recent Revision' : `Revision #${revision}`;
                commands.executeCommand('vscode.diff', tmpFileUri, doc.uri, Path.basename(doc.uri.fsPath) + ' - Diff Against ' + revisionLabel);
            }, (err) => {
                Display.showError(err.toString());
            })
        }
    }

    export function diffRevision() {
        var editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!checkFolderOpened()) {
            return false;
        }

        var doc = editor.document;

        const args = '-s "' + Utils.expansePath(doc.uri.fsPath) + '"';
        PerforceService.execute('filelog', (err, stdout, stderr) => {
            if (err) {
                Display.showError(err.message);
            } else if (stderr) {
                Display.showError(stderr.toString());
            } else {
                let revisions = stdout.split('\n'), revisionsData = [];
                revisions.shift();  // remove the first line - filename
                revisions.forEach(revisionInfo => {
                    if (revisionInfo.indexOf('... #') === -1)
                        return;

                    let splits = revisionInfo.split(' ');
                    let rev = splits[1].substring(1);    // splice 1st character '#'
                    let change = splits[3];
                    let changedesc = revisionInfo.substring(revisionInfo.indexOf(splits[9]) + splits[9].length + 1);
                    let label = '#' + rev + '  change: ' + change + '  Desc: ' + changedesc;
                    revisionsData.push({ rev: rev, change: change, changedesc: changedesc, label: label })
                });

                window.showQuickPick(revisionsData).then( revision => {
                    diff(parseInt(revision.rev));
                })

            }
        }, args);

    }

    export async function annotate() {
        var editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        const doc = editor.document;
        const conf = workspace.getConfiguration('perforce')
        const cl = conf.get('annotate.changelist');
        const usr = conf.get('annotate.user');
        let args = '-q';
        if (cl) args += 'c';
        if (usr) args += 'u';

        const decorationType = window.createTextEditorDecorationType({
            isWholeLine: true,
            before: {
                margin: '0 1.75em 0 0'
            }
        });
        let decorateColors: string[] = ['rgb(153, 153, 153)', 'rgb(103, 103, 103)' ];
        let decorations: DecorationOptions[] = [];
        let colorIndex = 0;
        let lastNum = '';

        const output: string = await Utils.getOutput('annotate', doc.uri.fsPath, null, args);
        const annotations = output.split(/\r?\n/);

        for (let i = 0, n = annotations.length; i < n; ++i) {
            const matches = annotations[i].match(usr ? /^(\d+): (\S+ \S+)/ : /^(\d+): /);
            if(matches) {
                const num = matches[1];
                const hoverMessage = matches[2];

                if (num !== lastNum) {
                    lastNum = num;
                    colorIndex = (colorIndex + 1) % decorateColors.length
                }

                const before: ThemableDecorationAttachmentRenderOptions = {
                    contentText: (cl ? '' : '#') + num,
                    color: decorateColors[colorIndex]
                };
                const renderOptions: DecorationInstanceRenderOptions = { before };

                decorations.push({
                    range: new Range(i, 0, i, 0),
                    hoverMessage,
                    renderOptions
                });

            }
        }

        let p4Uri = doc.uri;
        let query = encodeURIComponent('-q');
        p4Uri = p4Uri.with({
            scheme: 'perforce',
            authority: 'print',
            path: doc.uri.path,
            query: query
        });

        workspace.openTextDocument(p4Uri).then(d => {
            window.showTextDocument(d).then(e => {
                e.setDecorations(decorationType, decorations);
            })
        })

    }

    export function info() {
        if(!checkFolderOpened()) {
            return false;
        }

        showOutput();
        PerforceService.execute('info', PerforceService.handleCommonServiceResponse);
    }

    export function opened() {
        if(!checkFolderOpened()) {
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
                    where(whereFile).then((result) => {
                        // https://www.perforce.com/perforce/r14.2/manuals/cmdref/p4_where.html
                        var results = result.split(' ');
                        if (results.length >= 3) {
                            var fileToOpen = results[2].trim();
                            workspace.openTextDocument(Uri.file(fileToOpen)).then((document) => {
                                window.showTextDocument(document);
                            }, (reason) => {
                                Display.showError(reason);
                            });
                        }
                    }).catch((reason) => {
                        Display.showError(reason);
                    });
                });
            }
        });
    }

    function where(file: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if(!checkFolderOpened()) {
                reject();
                return;
            }
            const args = '"' + file + '"';
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
            }, args);
        });
    }

    export function logout() {
        PerforceService.execute('logout', (err, stdout, stderr) => {
            if(err) {
                Display.showError(err.message);
                return false;
            } else if(stderr) {
                Display.showError(stderr.toString());
                return false;
            } else {
                Display.showMessage("Logout successful");
                Display.updateEditor();
                return true;
            }
        });
    }

    export function login() {
        PerforceService.execute('login', (err, stdout, stderr) => {
            if(err || stderr) {
                window.showInputBox({'prompt': 'Enter password', 'password': true}).then(passwd => {
                    PerforceService.execute('login', (err, stdout, stderr) => {
                        if (err) {
                            Display.showError(err.message);
                            return false;
                        } else if (stderr) {
                            Display.showError(stderr.toString());
                            return false;
                        } else {
                            Display.showMessage("Login successful");
                            Display.updateEditor();
                            return true;
                        }
                    }, null, null, passwd);
                });

            } else {
                Display.showMessage("Login successful");
                Display.updateEditor();
                return true;
            }
        }, '-s');
    }

    export function showOutput() {
        Display.channel.show();
    }

    export function menuFunctions() {
        var items = [];
        items.push({ label: "add", description: "Open a new file to add it to the depot" });
        items.push({ label: "edit", description: "Open an existing file for edit" });
        items.push({ label: "revert", description: "Discard changes from an opened file" });
        items.push({ label: "submitDefault", description: "Submit or Save the default changelist" });
        items.push({ label: "diff", description: "Display diff of client file with depot file" });
        items.push({ label: "diffRevision", description: "Display diff of client file with depot file at a specific revision" });
        items.push({ label: "annotate", description: "Print file lines and their revisions" });
        items.push({ label: "info", description: "Display client/server information" });
        items.push({ label: "opened", description: "View 'open' files and open one in editor" });
        items.push({ label: "login", description: "Log in to Perforce" });
        items.push({ label: "logout", description: "Log out from Perforce" });
        window.showQuickPick(items, {matchOnDescription: true, placeHolder: "Choose a Perforce command:"}).then(function (selection) {
            if(selection == undefined)
                return;
            switch (selection.label) {
                case "add":
                    addOpenFile();
                    break;
                case "edit":
                    editOpenFile();
                    break;
                case "revert":
                    revert();
                    break;
                case "submitDefault":
                    PerforceSCMProvider.SubmitDefault();
                    break;
                case "diff":
                    diff();
                    break;
                case "diffRevision":
                    diffRevision();
                    break;
                case "annotate":
                    annotate();
                    break;
                case "info":
                    info();
                    break;
                case "opened":
                    opened();
                    break;
                case "login":
                    login();
                    break;
                case "logout":
                    logout();
                    break;
                default:
                    break;
            }
        });
    }

    function checkFileSelected() {
        if(!window.activeTextEditor) {
            Display.showMessage("No file selected");
            return false;
        }

        return true;
    }

    export function checkFolderOpened() {
        if (workspace.rootPath == undefined) {
            Display.showMessage("No folder selected");
            return false;
        }

        return true;
    }
}