"use strict";

import {
    window,
    workspace,
    Disposable,
    FileCreateEvent,
    TextDocument,
    TextDocumentChangeEvent,
    Uri,
    TextDocumentSaveReason,
    FileType,
    FileWillDeleteEvent
} from "vscode";

import * as micromatch from "micromatch";

import { Display } from "./Display";
import { PerforceCommands } from "./PerforceCommands";
import { PerforceSCMProvider } from "./ScmProvider";
import { ConfigAccessor } from "./ConfigService";

export interface FileSystemEventProvider {
    onWillSaveTextDocument: typeof workspace.onWillSaveTextDocument;
    onDidChangeTextDocument: typeof workspace.onDidChangeTextDocument;
    onDidCreateFiles: typeof workspace.onDidCreateFiles;
    onWillDeleteFiles: typeof workspace.onWillDeleteFiles;
}

export default class FileSystemActions {
    private static _eventRegistered: boolean = false;
    private static _lastCheckedFileUri?: Uri = undefined;
    private static _lastSavedFileUri?: Uri = undefined;

    private _disposable: Disposable;
    private static _eventsDisposable: Disposable;

    constructor(workspace: FileSystemEventProvider, config: ConfigAccessor) {
        const subscriptions: Disposable[] = [];

        window.onDidChangeActiveTextEditor(Display.updateEditor, this, subscriptions);

        if (PerforceCommands.checkFolderOpened()) {
            FileSystemActions.registerEvents(workspace, config);
        }

        this._disposable = Disposable.from.apply(this, subscriptions);
    }

    private static registerEvents(
        workspace: FileSystemEventProvider,
        config: ConfigAccessor
    ) {
        if (!FileSystemActions._eventRegistered) {
            FileSystemActions._eventsDisposable?.dispose();

            const eventSubscriptions: Disposable[] = [];

            if (config.editOnFileSave) {
                workspace.onWillSaveTextDocument(e => {
                    e.waitUntil(FileSystemActions.onWillSaveFile(e.document, e.reason));
                }, eventSubscriptions);
            }

            if (config.editOnFileModified) {
                workspace.onDidChangeTextDocument(
                    FileSystemActions.onFileModified.bind(this),
                    eventSubscriptions
                );
            }

            if (config.addOnFileCreate) {
                workspace.onDidCreateFiles(
                    FileSystemActions.onFilesAdded.bind(this),
                    eventSubscriptions
                );
            }

            if (config.deleteOnFileDelete) {
                workspace.onWillDeleteFiles(
                    FileSystemActions.onFilesDeleted.bind(this),
                    eventSubscriptions
                );
            }

            FileSystemActions._eventRegistered = true;
            FileSystemActions._eventsDisposable = Disposable.from.apply(
                this,
                eventSubscriptions
            );
        }
    }

    public dispose() {
        this._disposable.dispose();
    }

    public static disposeEvents() {
        this._eventRegistered = false;
        this._eventsDisposable.dispose();
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

    private static async isDirectory(uri: Uri) {
        try {
            const stat = await workspace.fs.stat(uri);
            return stat.type === FileType.Directory;
        } catch (err) {
            // still try to revert
            Display.channel.appendLine(err);
        }
        return false;
    }

    private static async deleteFileOrDirectory(uri: Uri) {
        const isDirectory = await FileSystemActions.isDirectory(uri);

        const fullUri = isDirectory ? uri.with({ path: uri.path + "/..." }) : uri;

        // DO NOT AWAIT the revert, because we are holding up the deletion
        PerforceCommands.p4revertAndDelete(fullUri);
    }

    private static shouldExclude(uri: Uri): boolean {
        const fileExcludes = Object.keys(workspace.getConfiguration("files").exclude);

        return micromatch.isMatch(uri.fsPath, fileExcludes, {
            dot: true
        });
    }

    private static onFilesDeleted(filesDeleted: FileWillDeleteEvent) {
        const promises = filesDeleted.files
            .filter(uri => !FileSystemActions.shouldExclude(uri))
            .map(uri => FileSystemActions.deleteFileOrDirectory(uri));

        filesDeleted.waitUntil(Promise.all(promises));
    }

    private static onFilesAdded(filesAdded: FileCreateEvent) {
        for (const uri of filesAdded.files) {
            PerforceCommands.p4add(uri);
        }
    }
}
