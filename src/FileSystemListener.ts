'use strict'

import {
    window,
    workspace,
    Disposable,
    FileSystemWatcher,
    TextDocument,
    TextDocumentChangeEvent,
    Uri
} from 'vscode';

import * as micromatch from 'micromatch';
import * as parseignore from 'parse-gitignore';

import {Display} from './Display';
import {PerforceCommands} from './PerforceCommands';
import {PerforceService} from './PerforceService';

export default class FileSystemListener
{
    private _disposable: Disposable;
    private _watcher: FileSystemWatcher;

    private _lastCheckedFilePath: Uri;
    private _p4ignore: string[];

    constructor() {
        const subscriptions: Disposable[] = [];
        window.onDidChangeActiveTextEditor(Display.updateEditor, this, subscriptions);

        var config = workspace.getConfiguration('perforce');

        if(config && PerforceCommands.checkFolderOpened()) {
            if(config['editOnFileSave']) {
                workspace.onWillSaveTextDocument(e => {
                    e.waitUntil(this.onWillSaveFile(e.document));
                }, this, subscriptions);
            }
            
            if(config['editOnFileModified']) {
                workspace.onDidChangeTextDocument(this.onFileModified, this, subscriptions);
            }

            if(config['addOnFileCreate'] || config['deleteOnFileDelete']) {
                this._watcher = workspace.createFileSystemWatcher('**/*', false, true, false);

                if(config['addOnFileCreate']) {
                    this._watcher.onDidCreate(this.onFileCreated, this, subscriptions);
                }

                if(config['deleteOnFileDelete']) {
                    this._watcher.onDidDelete(this.onFileDeleted, this, subscriptions);
                }
            }
        }

        this._p4ignore = [];

        const p4IgnoreFileName = process.env.P4IGNORE ? process.env.P4IGNORE : '.p4ignore';
        workspace.findFiles(p4IgnoreFileName, null, 1).then((result) => {
            if (result && result.length > 0) {
                this._p4ignore = parseignore(result[0].fsPath);
            }
        });

        this._disposable = Disposable.from.apply(this, subscriptions);
    }

    public dispose() {
        this._disposable.dispose();
    }

    private onWillSaveFile(doc: TextDocument): Promise<boolean> {
        return this.tryEditFile(doc.uri);
    }

    private onFileModified(docChange: TextDocumentChangeEvent) {
        var docUri = docChange.document.uri;

        //If this doc has already been checked, just returned
        if (docUri.toString() == this._lastCheckedFilePath.toString()) {
            return;
        }

        //Only try to open files open in the editor
        var editor = window.activeTextEditor;
        if (!editor || !editor.document || editor.document.uri.toString() != docUri.toString()) {
            return;
        }

        this._lastCheckedFilePath = docUri;
        this.tryEditFile(docUri);
    }

    private tryEditFile(uri: Uri): Promise<boolean> {
        //TODO: needed?
        //let docPath = PerforceService.convertToRel(uri.fsPath);
        
        return new Promise((resolve, reject) => {
            //Check if this file is in client root first
            this.fileInClientRoot(uri).then((inClientRoot) => {
                if(inClientRoot) {
                    return this.fileIsOpened(uri);
                }
                resolve();
            }).then((isOpened) => {
                //If not opened, open file for edit
                if(!isOpened) {
                    return PerforceCommands.edit(uri);
                }
                resolve();
            }).then((openedForEdit) => {
                resolve();
            }).catch((reason) => {
                if(reason) Display.showError(reason.toString());
                reject(reason);
            });
        });
    }

    private onFileDeleted(uri: Uri) {
        const fileExcludes = Object.keys(workspace.getConfiguration('files').exclude);
        const ignoredPatterns = this._p4ignore.concat(fileExcludes);

        const shouldIgnore: boolean = micromatch.any(uri.fsPath, ignoredPatterns, { dot: true });

        // Only `p4 delete` files that are not marked as ignored either in:
        // .p4ignore
        // files.exclude setting
        if (!shouldIgnore) {
            PerforceCommands.p4delete(uri);
        }
    }

    private onFileCreated(uri: Uri) {
        //Only try to add files open in the editor
        var editor = window.activeTextEditor;
        if(editor && editor.document && editor.document.uri.fsPath == uri.fsPath) {
            PerforceCommands.add(uri);
        }
    }

    private fileInClientRoot(uri: Uri): Promise<boolean> {
        let docPath = uri.fsPath;
        return new Promise((resolve, reject) => {
            PerforceService.getClientRoot(uri).then((clientRoot) => {
                //Convert to lower and Strip newlines from paths
                clientRoot = clientRoot.toLowerCase().replace(/(\r\n|\n|\r)/gm,"");
                var filePath = docPath.toLowerCase().replace(/(\r\n|\n|\r)/gm,"");

                //Check if p4 Client Root is in uri's path
                if(filePath.indexOf(clientRoot) !== -1) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            }).catch((err) => {
                reject(err);
            });
        });
    }

    private fileIsOpened(fileUri: Uri): Promise<boolean> {
        return new Promise((resolve, reject) => {
            //opened stdout is set if file open, stderr set if not opened
            //TODO: valid ?
            PerforceService.executeAsPromise(fileUri, 'opened', fileUri.fsPath).then((stdout) => {
                resolve(true);
            }).catch((stderr) => {
                resolve(false);
            });
        });
    }
}
