"use strict";

import {
    commands,
    workspace,
    window,
    Uri,
    ThemableDecorationAttachmentRenderOptions,
    DecorationInstanceRenderOptions,
    DecorationOptions,
    Range,
    QuickPickItem,
    MarkdownString
} from "vscode";

import * as Path from "path";

import { PerforceService } from "./PerforceService";
import { Display } from "./Display";
import { Utils } from "./Utils";

// TODO resolve
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PerforceCommands {
    export function registerCommands() {
        commands.registerCommand("perforce.add", addOpenFile);
        commands.registerCommand("perforce.edit", editOpenFile);
        commands.registerCommand("perforce.delete", deleteOpenFile);
        commands.registerCommand("perforce.revert", revert);
        commands.registerCommand("perforce.diff", diff);
        commands.registerCommand("perforce.diffRevision", diffRevision);
        commands.registerCommand("perforce.annotate", annotate);
        commands.registerCommand("perforce.opened", opened);
        commands.registerCommand("perforce.logout", logout);
        commands.registerCommand("perforce.login", login);
        commands.registerCommand("perforce.showOutput", showOutput);
        commands.registerCommand("perforce.menuFunctions", menuFunctions);
    }

    function addOpenFile() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        const fileUri = editor.document.uri;
        if (checkFolderOpened()) {
            add(fileUri);
        } else {
            add(fileUri, Path.dirname(fileUri.fsPath));
        }
    }

    export function add(fileUri: Uri, directoryOverride?: string) {
        const args = '"' + Utils.expansePath(fileUri.fsPath) + '"';
        PerforceService.execute(
            fileUri,
            "add",
            (err, stdout, stderr) => {
                PerforceService.handleCommonServiceResponse(err, stdout, stderr);
                if (!err) {
                    Display.showMessage("file opened for add");
                }
            },
            args,
            directoryOverride
        );
    }

    function editOpenFile() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        const fileUri = editor.document.uri;

        //If folder not opened, run p4 in files folder.
        if (checkFolderOpened()) {
            edit(fileUri);
        } else {
            edit(fileUri, Path.dirname(fileUri.fsPath));
        }
    }

    export function edit(fileUri: Uri, directoryOverride?: string): Promise<boolean> {
        return new Promise(resolve => {
            const args = '"' + Utils.expansePath(fileUri.fsPath) + '"';
            PerforceService.execute(
                fileUri,
                "edit",
                (err, stdout, stderr) => {
                    PerforceService.handleCommonServiceResponse(err, stdout, stderr);
                    if (!err) {
                        Display.showMessage("file opened for edit");
                    }
                    resolve(!err);
                },
                args,
                directoryOverride
            );
        });
    }

    function deleteOpenFile() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        revert();
        const fileUri = editor.document.uri;
        p4delete(fileUri);
    }

    export function p4delete(fileUri: Uri) {
        const args = '"' + Utils.expansePath(fileUri.fsPath) + '"';
        PerforceService.execute(
            fileUri,
            "delete",
            (err, stdout, stderr) => {
                PerforceService.handleCommonServiceResponse(err, stdout, stderr);
                if (!err) {
                    Display.showMessage("file marked for delete");
                }
            },
            args
        );
    }

    export function revert() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        //If folder not opened, overrided p4 directory
        const fileUri = editor.document.uri;
        const directoryOverride = !checkFolderOpened()
            ? Path.dirname(fileUri.fsPath)
            : undefined;

        const args = '"' + Utils.expansePath(fileUri.fsPath) + '"';
        PerforceService.execute(
            fileUri,
            "revert",
            (err, stdout, stderr) => {
                PerforceService.handleCommonServiceResponse(err, stdout, stderr);
                if (!err) {
                    Display.showMessage("file reverted");
                }
            },
            args,
            directoryOverride
        );
    }

    export function diff(revision?: number) {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!checkFolderOpened()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        const doc = editor.document;

        if (!doc.isUntitled) {
            Utils.getFile("print", doc.uri, revision).then(
                (tmpFile: string) => {
                    const tmpFileUri = Uri.file(tmpFile);
                    const revisionLabel =
                        !revision || isNaN(revision)
                            ? "Most Recent Revision"
                            : `Revision #${revision}`;
                    commands.executeCommand(
                        "vscode.diff",
                        tmpFileUri,
                        doc.uri,
                        Path.basename(doc.uri.fsPath) + " - Diff Against " + revisionLabel
                    );
                },
                err => {
                    Display.showError(err.toString());
                }
            );
        }
    }

    export function diffRevision() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!checkFolderOpened()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        const doc = editor.document;

        const args = '-s "' + Utils.expansePath(doc.uri.fsPath) + '"';
        PerforceService.execute(
            doc.uri,
            "filelog",
            (err, stdout, stderr) => {
                if (err) {
                    Display.showError(err.message);
                } else if (stderr) {
                    Display.showError(stderr.toString());
                } else {
                    const revisions = stdout.split("\n");
                    const revisionsData: QuickPickItem[] = [];
                    revisions.shift(); // remove the first line - filename
                    revisions.forEach(revisionInfo => {
                        if (!revisionInfo.includes("... #")) {
                            return;
                        }

                        const splits = revisionInfo.split(" ");
                        const rev = splits[1].substring(1); // splice 1st character '#'
                        const change = splits[3];
                        const label = `#${rev} change: ${change}`;
                        const description = revisionInfo.substring(
                            revisionInfo.indexOf(splits[9]) + splits[9].length + 1
                        );

                        revisionsData.push({ label, description });
                    });

                    window.showQuickPick(revisionsData).then(revision => {
                        if (revision) {
                            diff(parseInt(revision.label.substring(1)));
                        }
                    });
                }
            },
            args
        );
    }

    export async function annotate() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        const doc = editor.document;
        const conf = workspace.getConfiguration("perforce");
        const cl = conf.get("annotate.changelist");
        const usr = conf.get("annotate.user");
        const swarmHost = conf.get("swarmHost");
        let args = "-q";
        if (cl) {
            args += "c";
        }
        if (usr) {
            args += "u";
        }

        const decorationType = window.createTextEditorDecorationType({
            isWholeLine: true,
            before: {
                margin: "0 1.75em 0 0"
            }
        });
        const decorateColors: string[] = ["rgb(153, 153, 153)", "rgb(103, 103, 103)"];
        const decorations: DecorationOptions[] = [];
        let colorIndex = 0;
        let lastNum = "";

        const output: string = await Utils.runCommandForFile(
            "annotate",
            doc.uri,
            undefined,
            args
        );
        const annotations = output.split(/\r?\n/);

        for (let i = 0, n = annotations.length; i < n; ++i) {
            const matches = new RegExp(usr ? /^(\d+): (\S+ \S+)/ : /^(\d+): /).exec(
                annotations[i]
            );
            if (matches) {
                const num = matches[1];
                const hoverMessage = swarmHost
                    ? new MarkdownString(
                          `[${num + " " + matches[2]}](${swarmHost}/changes/${num})`
                      )
                    : matches[2];

                if (num !== lastNum) {
                    lastNum = num;
                    colorIndex = (colorIndex + 1) % decorateColors.length;
                }

                const before: ThemableDecorationAttachmentRenderOptions = {
                    contentText: (cl ? "" : "#") + num,
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

        const p4Uri = Utils.makePerforceDocUri(doc.uri, "print", "-q");

        workspace.openTextDocument(p4Uri).then(d => {
            window.showTextDocument(d).then(e => {
                e.setDecorations(decorationType, decorations);
            });
        });
    }

    export function opened() {
        if (!checkFolderOpened()) {
            return false;
        }
        if (!workspace.workspaceFolders) {
            return false;
        }
        let resource = workspace.workspaceFolders[0].uri;
        if (workspace.workspaceFolders.length > 1) {
            // try to find the proper workspace
            if (window.activeTextEditor && window.activeTextEditor.document) {
                const wksFolder = workspace.getWorkspaceFolder(
                    window.activeTextEditor.document.uri
                );
                if (wksFolder) {
                    resource = wksFolder.uri;
                }
            }
        }

        PerforceService.execute(resource, "opened", (err, stdout, stderr) => {
            if (err) {
                Display.showError(err.message);
            } else if (stderr) {
                Display.showError(stderr.toString());
            } else {
                const opened = stdout
                    .toString()
                    .trim()
                    .split("\n");
                if (opened.length === 0) {
                    return false;
                }

                const options = opened.map(file => {
                    return {
                        description: file,
                        label: Path.basename(file)
                    };
                });

                window
                    .showQuickPick(options, { matchOnDescription: true })
                    .then(selection => {
                        if (!selection) {
                            return false;
                        }

                        const depotPath = selection.description;
                        const whereFile = depotPath.substring(0, depotPath.indexOf("#"));
                        where(whereFile)
                            .then(result => {
                                // https://www.perforce.com/perforce/r14.2/manuals/cmdref/p4_where.html
                                const results = result.split(" ");
                                if (results.length >= 3) {
                                    const fileToOpen = results[2].trim();
                                    workspace.openTextDocument(Uri.file(fileToOpen)).then(
                                        document => {
                                            window.showTextDocument(document);
                                        },
                                        reason => {
                                            Display.showError(reason);
                                        }
                                    );
                                }
                            })
                            .catch(reason => {
                                Display.showError(reason);
                            });
                    });
            }
        });
    }

    function where(file: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!checkFolderOpened()) {
                reject();
                return;
            }

            const resource = Uri.file(file);
            const args = '"' + file + '"';
            PerforceService.execute(
                resource,
                "where",
                (err, stdout, stderr) => {
                    if (err) {
                        Display.showError(err.message);
                        reject(err);
                    } else if (stderr) {
                        Display.showError(stderr.toString());
                        reject(stderr);
                    } else {
                        resolve(stdout.toString());
                    }
                },
                args
            );
        });
    }

    // Try to guess the proper workspace to use
    function guessWorkspaceUri(): Uri {
        if (window.activeTextEditor && !window.activeTextEditor.document.isUntitled) {
            const wksFolder = workspace.getWorkspaceFolder(
                window.activeTextEditor.document.uri
            );
            if (wksFolder) {
                return wksFolder.uri;
            }
        }

        if (workspace.workspaceFolders) {
            return workspace.workspaceFolders[0].uri;
        } else {
            return Uri.parse("");
        }
    }

    export function logout() {
        const resource = guessWorkspaceUri();
        PerforceService.execute(resource, "logout", (err, stdout, stderr) => {
            if (err) {
                Display.showError(err.message);
                return false;
            } else if (stderr) {
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
        const resource = guessWorkspaceUri();
        PerforceService.execute(
            resource,
            "login",
            (err, stdout, stderr) => {
                if (err || stderr) {
                    window
                        .showInputBox({ prompt: "Enter password", password: true })
                        .then(passwd => {
                            PerforceService.execute(
                                resource,
                                "login",
                                (err, stdout, stderr) => {
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
                                },
                                undefined,
                                undefined,
                                passwd
                            );
                        });
                } else {
                    Display.showMessage("Login successful");
                    Display.updateEditor();
                    return true;
                }
            },
            "-s"
        );
    }

    export function showOutput() {
        Display.channel.show();
    }

    export function menuFunctions() {
        const items: QuickPickItem[] = [];
        items.push({
            label: "add",
            description: "Open a new file to add it to the depot"
        });
        items.push({ label: "edit", description: "Open an existing file for edit" });
        items.push({
            label: "revert",
            description: "Discard changes from an opened file"
        });
        items.push({
            label: "diff",
            description: "Display diff of client file with depot file"
        });
        items.push({
            label: "diffRevision",
            description:
                "Display diff of client file with depot file at a specific revision"
        });
        items.push({
            label: "annotate",
            description: "Print file lines and their revisions"
        });
        items.push({ label: "info", description: "Display client/server information" });
        items.push({
            label: "opened",
            description: "View 'open' files and open one in editor"
        });
        items.push({ label: "login", description: "Log in to Perforce" });
        items.push({ label: "logout", description: "Log out from Perforce" });
        window
            .showQuickPick(items, {
                matchOnDescription: true,
                placeHolder: "Choose a Perforce command:"
            })
            .then(function(selection) {
                if (selection === undefined) {
                    return;
                }
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
                    case "diff":
                        diff();
                        break;
                    case "diffRevision":
                        diffRevision();
                        break;
                    case "annotate":
                        annotate();
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
        if (!window.activeTextEditor) {
            Display.showMessage("No file selected");
            return false;
        }

        return true;
    }

    export function checkFolderOpened() {
        if (workspace.workspaceFolders === undefined) {
            Display.showMessage("No folder selected\n");
            return false;
        }

        return true;
    }
}
