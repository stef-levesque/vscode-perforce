"use strict";

import {
    window,
    workspace,
    Disposable,
    FileSystemWatcher,
    TextDocument,
    TextDocumentChangeEvent,
    RelativePattern,
    Uri,
    WorkspaceFolder,
    TextDocumentSaveReason
} from "vscode";

import * as micromatch from "micromatch";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parseignore = require("parse-gitignore"); // (this module should be removed anyway)

import { Display } from "./Display";
import { PerforceCommands } from "./PerforceCommands";
import { PerforceSCMProvider } from "./ScmProvider";

export default class FileSystemListener {
    private static _eventRegistered: boolean = false;
    private static _lastCheckedFileUri?: Uri = undefined;
    private static _lastSavedFileUri?: Uri = undefined;

    private _disposable: Disposable;
    private _watcher?: FileSystemWatcher;

    private _p4ignore: string[];

    constructor(workspaceFolder?: WorkspaceFolder) {
        const subscriptions: Disposable[] = [];
        window.onDidChangeActiveTextEditor(Display.updateEditor, this, subscriptions);

        const config = workspace.getConfiguration("perforce");

        if (config && PerforceCommands.checkFolderOpened()) {
            if (!FileSystemListener._eventRegistered) {
                if (config["editOnFileSave"]) {
                    workspace.onWillSaveTextDocument(e => {
                        e.waitUntil(
                            FileSystemListener.onWillSaveFile(e.document, e.reason)
                        );
                    });
                }

                if (config["editOnFileModified"]) {
                    workspace.onDidChangeTextDocument(
                        FileSystemListener.onFileModified.bind(this)
                    );
                }
                FileSystemListener._eventRegistered = true;
            }

            if (config["addOnFileCreate"] || config["deleteOnFileDelete"]) {
                const pattern = new RelativePattern(
                    workspaceFolder ? workspaceFolder : "",
                    "**/*"
                );
                this._watcher = workspace.createFileSystemWatcher(
                    pattern,
                    false,
                    true,
                    false
                );

                if (config["addOnFileCreate"]) {
                    this._watcher.onDidCreate(
                        this.onFileCreated.bind(this),
                        this,
                        subscriptions
                    );
                }

                if (config["deleteOnFileDelete"]) {
                    this._watcher.onDidDelete(
                        this.onFileDeleted.bind(this),
                        this,
                        subscriptions
                    );
                }
            }
        }

        this._p4ignore = [];

        let p4IgnoreFileName = process.env.P4IGNORE;
        if (!p4IgnoreFileName) {
            p4IgnoreFileName = ".p4ignore";
        }
        const pattern = new RelativePattern(
            workspaceFolder ? workspaceFolder : "",
            p4IgnoreFileName
        );
        workspace.findFiles(pattern, undefined, 1).then(result => {
            if (result && result.length > 0) {
                this._p4ignore = parseignore(result[0].fsPath);
            }
        });

        this._disposable = Disposable.from.apply(this, subscriptions);
    }

    public dispose() {
        this._disposable.dispose();
    }

    private static onWillSaveFile(
        doc: TextDocument,
        reason: TextDocumentSaveReason
    ): Promise<boolean> {
        if (
            FileSystemListener._lastSavedFileUri?.fsPath === doc.uri.fsPath &&
            reason !== TextDocumentSaveReason.Manual
        ) {
            // don't keep trying when auto-saving (e.g. if the file isn't intended for perforce)
            return Promise.resolve(true);
        } else {
            FileSystemListener._lastSavedFileUri = doc.uri;
            return FileSystemListener.tryEditFile(doc.uri);
        }
    }

    private static onFileModified(docChange: TextDocumentChangeEvent) {
        const docUri = docChange.document.uri;

        if (docUri.scheme !== "file") {
            return;
        }

        //If this doc has already been checked, just returned
        if (
            FileSystemListener._lastCheckedFileUri &&
            docUri.toString() === FileSystemListener._lastCheckedFileUri.toString()
        ) {
            return;
        }

        //Only try to open files open in the editor
        const editor = window.activeTextEditor;
        if (
            !editor ||
            !editor.document ||
            editor.document.uri.toString() !== docUri.toString()
        ) {
            return;
        }

        FileSystemListener._lastCheckedFileUri = docUri;
        FileSystemListener.tryEditFile(docUri);
    }

    // Had to streamline this, since `onWillSaveTextDocument` allows to delay
    // the save operation only for a few seconds. The time limit should be
    // configurable and/or the operation should be cancellable
    // in future releases.
    // https://github.com/stef-levesque/vscode-perforce/issues/110
    private static tryEditFile(uri: Uri): Promise<boolean> {
        if (
            PerforceSCMProvider.hasOpenFile(uri) &&
            !PerforceSCMProvider.mayHaveConflictForFile(uri)
        ) {
            return Promise.resolve(true);
        } else {
            return PerforceCommands.edit(uri);
        }

        // return new Promise((resolve) => {
        //     //Check if this file is in client root first
        //     FileSystemListener.fileInClientRoot(uri).then((inClientRoot) => {
        //         if (inClientRoot) {
        //             return FileSystemListener.fileIsOpened(uri);
        //         }
        //         resolve();
        //     }).then((isOpened) => {
        //         //If not opened, open file for edit
        //         if (!isOpened) {
        //             return PerforceCommands.edit(uri);
        //         }
        //         resolve();
        //     }).then((openedForEdit) => {
        //         resolve();
        //     }).catch((reason) => {
        //         if (reason) Display.showError(reason.toString());
        //         //reject(reason);
        //         resolve();
        //     });
        // });
    }

    private onFileDeleted(uri: Uri) {
        const fileExcludes = Object.keys(workspace.getConfiguration("files").exclude);
        const ignoredPatterns = this._p4ignore.concat(fileExcludes);

        const shouldIgnore: boolean = micromatch.isMatch(uri.fsPath, ignoredPatterns, {
            dot: true
        });

        // Only `p4 delete` files that are not marked as ignored either in:
        // .p4ignore
        // files.exclude setting
        if (!shouldIgnore) {
            PerforceCommands.p4delete(uri);
        }
    }

    private onFileCreated(uri: Uri) {
        //Only try to add files open in the editor
        const editor = window.activeTextEditor;
        if (editor && editor.document && editor.document.uri.fsPath === uri.fsPath) {
            PerforceCommands.add(uri);
        }
    }
}
