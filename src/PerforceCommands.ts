"use strict";

import {
    commands,
    workspace,
    window,
    Uri,
    QuickPickItem,
    Disposable,
    ProgressLocation,
} from "vscode";

import * as Path from "path";

import { PerforceService } from "./PerforceService";
import * as p4 from "./api/PerforceApi";
import { Display } from "./Display";
import { Utils } from "./Utils";
import * as PerforceUri from "./PerforceUri";
import { PerforceSCMProvider } from "./ScmProvider";
import * as AnnotationProvider from "./annotations/AnnotationProvider";
import * as DiffProvider from "./DiffProvider";
import * as QuickPicks from "./quickPick/QuickPicks";
import { showQuickPick } from "./quickPick/QuickPickProvider";

// TODO resolve
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PerforceCommands {
    export function registerCommands() {
        commands.registerCommand("perforce.add", addOpenFile);
        commands.registerCommand("perforce.edit", editOpenFile);
        commands.registerCommand("perforce.delete", deleteOpenFile);
        commands.registerCommand("perforce.revert", revertOpenFile);
        commands.registerCommand("perforce.submitSingle", submitSingle);
        commands.registerCommand("perforce.diff", diff);
        commands.registerCommand("perforce.diffRevision", diffRevision);
        commands.registerCommand("perforce.diffPrevious", diffPrevious);
        commands.registerCommand("perforce.diffNext", diffNext);
        commands.registerCommand("perforce.depotActions", showDepotActions);
        commands.registerCommand("perforce.showQuickPick", showQuickPick);
        commands.registerCommand("perforce.annotate", annotate);
        commands.registerCommand("perforce.opened", opened);
        commands.registerCommand("perforce.logout", logout);
        commands.registerCommand("perforce.login", login);
        commands.registerCommand("perforce.diffFiles", diffFiles);
        commands.registerCommand("perforce.menuFunctions", menuFunctions);
    }

    export function registerImportantCommands(subscriptions: Disposable[]) {
        subscriptions.push(
            commands.registerCommand(
                "perforce.editAndSave",
                editAndSaveOpenFileOrPassthrough
            )
        );
    }

    function addOpenFile() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        p4add(editor.document.uri);
    }

    export function p4add(fileUri: Uri) {
        const args = [Utils.expansePath(fileUri.fsPath)];
        PerforceService.execute(
            fileUri,
            "add",
            (err, stdout, stderr) => {
                PerforceService.handleCommonServiceResponse(err, stdout, stderr);
                if (!err) {
                    Display.showMessage("file opened for add");
                }
            },
            args
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

        p4edit(editor.document.uri);
    }

    async function editAndSaveOpenFileOrPassthrough() {
        const activeFile = window.activeTextEditor?.document;
        if (!activeFile) {
            // pass through to the save action in case it can do anything else
            await commands.executeCommand("workbench.action.files.save");
        } else {
            try {
                await window.withProgress(
                    {
                        location: ProgressLocation.Notification,
                        title: "Perforce: Opening file for edit",
                    },
                    () => p4edit(activeFile.uri)
                );
            } catch (err) {
                // ensure save always happens even if something goes wrong
                Display.showError(err);
            }

            await activeFile.save();
        }
    }

    export function p4edit(fileUri: Uri): Promise<boolean> {
        return new Promise((resolve) => {
            const args = [Utils.expansePath(fileUri.fsPath)];
            PerforceService.execute(
                fileUri,
                "edit",
                (err, stdout, stderr) => {
                    PerforceService.handleCommonServiceResponse(err, stdout, stderr);
                    if (!err && !stderr) {
                        Display.showMessage("file opened for edit");
                    }
                    resolve(!err);
                },
                args
            );
        });
    }

    export async function deleteOpenFile() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        await revertOpenFile();
        const fileUri = editor.document.uri;
        await p4delete(fileUri);
    }

    export async function p4delete(fileUri: Uri) {
        const deleteOpts: p4.DeleteOptions = { paths: [fileUri] };
        try {
            await p4.del(fileUri, deleteOpts);
            Display.showMessage(fileUri.fsPath + " deleted.");
            Display.updateEditor();
            PerforceSCMProvider.RefreshAll();
        } catch (err) {
            // no work - just catch exception.  Error will be
            // reported by perforce command code
        }
    }

    export async function revertOpenFile() {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return false;
        }

        if (!editor || !editor.document) {
            return false;
        }

        const fileUri = editor.document.uri;
        await p4revert(fileUri);
    }

    export async function p4revert(fileUri: Uri) {
        const revertOpts: p4.RevertOptions = { paths: [fileUri] };
        try {
            await p4.revert(fileUri, revertOpts);
            Display.showMessage(fileUri.fsPath + " reverted.");
            Display.updateEditor();
            PerforceSCMProvider.RefreshAll();
        } catch (err) {
            // no work - just catch exception.  Error will be
            // reported by perforce command code
        }
    }

    export async function p4revertAndDelete(uri: Uri) {
        await PerforceCommands.p4revert(uri);
        await PerforceCommands.p4delete(uri);
    }

    export async function submitSingle() {
        const file = window.activeTextEditor?.document.uri;
        if (!file || file.scheme !== "file") {
            Display.showError("No open file to submit");
            return;
        }

        if (window.activeTextEditor?.document.isDirty) {
            Display.showModalMessage(
                "The active document has unsaved changes. Save the file first!"
            );
            return;
        }
        const description = await window.showInputBox({
            prompt:
                "Enter a changelist description to submit '" +
                Path.basename(file.fsPath) +
                "'",
            validateInput: (input) => {
                if (!input.trim()) {
                    return "Description must not be empty";
                }
            },
        });
        if (!description) {
            return;
        }

        const output = await p4.submitChangelist(file, { description, file });
        PerforceSCMProvider.RefreshAll();
        Display.showMessage("Changelist " + output.chnum + " submitted");
    }

    export async function diff(revision?: number) {
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
            if (!revision) {
                await diffPrevious(editor.document.uri);
                return;
            }

            const revStr = revision && !isNaN(revision) ? revision.toString() : "have";
            const depotUri = PerforceUri.fromUriWithRevision(doc.uri, revStr);
            const rightUri = doc.uri;

            await DiffProvider.diffFiles(depotUri, rightUri);
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

        const args = ["-s", Utils.expansePath(doc.uri.fsPath)];
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
                    revisions.forEach((revisionInfo) => {
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

                    window.showQuickPick(revisionsData).then((revision) => {
                        if (revision) {
                            diff(parseInt(revision.label.substring(1)));
                        }
                    });
                }
            },
            args
        );
    }

    async function diffPrevious(fromDoc?: Uri) {
        if (!fromDoc) {
            fromDoc = window.activeTextEditor?.document.uri;
        }
        if (!fromDoc) {
            Display.showError("No file to diff");
            return false;
        }
        await DiffProvider.diffPrevious(fromDoc);
    }

    async function diffNext(fromDoc?: Uri) {
        if (!fromDoc) {
            fromDoc = window.activeTextEditor?.document.uri;
        }
        if (!fromDoc) {
            Display.showError("No file to diff");
            return false;
        }
        await DiffProvider.diffNext(fromDoc);
    }

    async function diffFiles(leftFile: string, rightFile: string) {
        await DiffProvider.diffFiles(Uri.parse(leftFile), Uri.parse(rightFile));
    }

    function getOpenDocUri(): Uri | undefined {
        const editor = window.activeTextEditor;
        if (!checkFileSelected()) {
            return;
        }

        if (!editor || !editor.document) {
            return;
        }

        const doc = editor.document;
        return doc.uri;
    }

    async function showDepotActions() {
        // DO NOT USE URI from vscode command - only returns the right uri - we need the active editor
        const fromDoc = window.activeTextEditor?.document.uri;
        if (!fromDoc) {
            Display.showError("No document selected");
            return;
        }
        await QuickPicks.showQuickPickForFile(fromDoc);
    }

    export async function annotate(file?: string) {
        const uri = file ? Uri.parse(file) : getOpenDocUri();

        if (!uri) {
            return false;
        }

        await AnnotationProvider.annotate(uri);
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
                const opened = stdout.toString().trim().split("\n");
                if (opened.length === 0) {
                    return false;
                }

                const options = opened.map((file) => {
                    return {
                        description: file,
                        label: Path.basename(file),
                    };
                });

                window
                    .showQuickPick(options, { matchOnDescription: true })
                    .then((selection) => {
                        if (!selection) {
                            return false;
                        }

                        const depotPath = selection.description;
                        const whereFile = depotPath.substring(0, depotPath.indexOf("#"));
                        where(whereFile)
                            .then((result) => {
                                // https://www.perforce.com/perforce/r14.2/manuals/cmdref/p4_where.html
                                const results = result.split(" ");
                                if (results.length >= 3) {
                                    const fileToOpen = results[2].trim();
                                    workspace.openTextDocument(Uri.file(fileToOpen)).then(
                                        (document) => {
                                            window.showTextDocument(document);
                                        },
                                        (reason) => {
                                            Display.showError(reason);
                                        }
                                    );
                                }
                            })
                            .catch((reason) => {
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
            const args = [file];
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

    export async function logout() {
        const resource = guessWorkspaceUri();
        try {
            await p4.logout(resource, {});
            Display.showMessage("Logout successful");
            Display.updateEditor();
            return true;
        } catch {}
        return false;
    }

    export async function login() {
        const resource = guessWorkspaceUri();

        let loggedIn = await p4.isLoggedIn(resource);
        if (!loggedIn) {
            const password = await window.showInputBox({
                prompt: "Enter password",
                password: true,
            });
            if (password) {
                try {
                    await p4.login(resource, { password });

                    Display.showMessage("Login successful");
                    Display.updateEditor();
                    loggedIn = true;
                    PerforceSCMProvider.RefreshAll();
                } catch {}
            }
        } else {
            Display.showMessage("Login successful");
            Display.updateEditor();
            loggedIn = true;
        }
        return loggedIn;
    }

    export function menuFunctions() {
        const items: QuickPickItem[] = [];
        items.push({
            label: "add",
            description: "Open a new file to add it to the depot",
        });
        items.push({ label: "edit", description: "Open an existing file for edit" });
        items.push({
            label: "revert",
            description: "Discard changes from an opened file",
        });
        items.push({
            label: "submit single file",
            description: "Submit the open file, ONLY if it is in the default changelist",
        });
        items.push({
            label: "diff",
            description: "Display diff of client file with depot file",
        });
        items.push({
            label: "diffRevision",
            description:
                "Display diff of client file with depot file at a specific revision",
        });
        items.push({
            label: "annotate",
            description: "Print file lines and their revisions",
        });
        items.push({ label: "info", description: "Display client/server information" });
        items.push({
            label: "opened",
            description: "View 'open' files and open one in editor",
        });
        items.push({ label: "login", description: "Log in to Perforce" });
        items.push({ label: "logout", description: "Log out from Perforce" });
        window
            .showQuickPick(items, {
                matchOnDescription: true,
                placeHolder: "Choose a Perforce command:",
            })
            .then(function (selection) {
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
                        revertOpenFile();
                        break;
                    case "submit single file":
                        submitSingle();
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
            Display.showMessage("No folder selected");
            return false;
        }

        return true;
    }
}
