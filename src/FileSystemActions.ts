"use strict";

import {
    window,
    workspace,
    Disposable,
    FileCreateEvent,
    FileDeleteEvent,
    TextDocument,
    TextDocumentChangeEvent,
    Uri,
    TextDocumentSaveReason
} from "vscode";

import * as micromatch from "micromatch";

import { Display } from "./Display";
import { PerforceCommands } from "./PerforceCommands";
import { PerforceSCMProvider } from "./ScmProvider";

export default class FileSystemActions {
    private static _eventRegistered: boolean = false;
    private static _lastCheckedFileUri?: Uri = undefined;
    private static _lastSavedFileUri?: Uri = undefined;

    private _disposable: Disposable;

    constructor() {
        const subscriptions: Disposable[] = [];
        window.onDidChangeActiveTextEditor(Display.updateEditor, this, subscriptions);

        const config = workspace.getConfiguration("perforce");

        if (config && PerforceCommands.checkFolderOpened()) {
            if (!FileSystemActions._eventRegistered) {
                if (config["editOnFileSave"]) {
                    workspace.onWillSaveTextDocument(e => {
                        e.waitUntil(
                            FileSystemActions.onWillSaveFile(e.document, e.reason)
                        );
                    });
                }

                if (config["editOnFileModified"]) {
                    workspace.onDidChangeTextDocument(
                        FileSystemActions.onFileModified.bind(this)
                    );
                }

                if (config["addOnFileCreate"]) {
                    workspace.onDidCreateFiles(FileSystemActions.onFilesAdded.bind(this));
                }

                if (config["deleteOnFileDelete"]) {
                    workspace.onDidDeleteFiles(
                        FileSystemActions.onFilesDeleted.bind(this)
                    );
                }

                FileSystemActions._eventRegistered = true;
            }
        }

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
            FileSystemActions._lastSavedFileUri?.fsPath === doc.uri.fsPath &&
            reason !== TextDocumentSaveReason.Manual
        ) {
            // don't keep trying when auto-saving (e.g. if the file isn't intended for perforce)
            return Promise.resolve(true);
        } else {
            FileSystemActions._lastSavedFileUri = doc.uri;
            return FileSystemActions.tryEditFile(doc.uri);
        }
    }

    private static onFileModified(docChange: TextDocumentChangeEvent) {
        const docUri = docChange.document.uri;

        if (docUri.scheme !== "file") {
            return;
        }

        //If this doc has already been checked, just returned
        if (
            FileSystemActions._lastCheckedFileUri &&
            docUri.toString() === FileSystemActions._lastCheckedFileUri.toString()
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

        FileSystemActions._lastCheckedFileUri = docUri;
        FileSystemActions.tryEditFile(docUri);
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
            return PerforceCommands.p4edit(uri);
        }
    }

    private static async onFilesDeleted(filesDeleted: FileDeleteEvent) {
        for (const uri of filesDeleted.files) {
            const fileExcludes = Object.keys(workspace.getConfiguration("files").exclude);

            const shouldIgnore: boolean = micromatch.isMatch(uri.fsPath, fileExcludes, {
                dot: true
            });
            if (!shouldIgnore) {
                // revert before delete in case it's optn for add/edit.  At
                // come point maybe dialog to warn user but this does
                // match logic in PerforceCommands
                await PerforceCommands.p4revert(uri);
                await PerforceCommands.p4delete(uri);
            }
        }
    }

    private static onFilesAdded(filesAdded: FileCreateEvent) {
        for (const uri of filesAdded.files) {
            PerforceCommands.p4add(uri);
        }
    }
}
