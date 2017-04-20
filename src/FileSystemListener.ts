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

    private _lastCheckedFilePath: string;
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
        workspace.findFiles('.p4ignore', null, 1).then((result) => {
            if (result.length > 0) {
                this._p4ignore = parseignore(result[0].fsPath);
            }
        });

        this._disposable = Disposable.from.apply(this, subscriptions);
    }

    public dispose() {
        this._disposable.dispose();
    }

    private onWillSaveFile(doc: TextDocument): Promise<boolean> {
        return this.tryEditFile(doc.uri.fsPath);
    }

    private onFileModified(docChange: TextDocumentChangeEvent) {
        var docPath = docChange.document.uri.fsPath;

        //If this doc has already been checked, just returned
        if(docPath == this._lastCheckedFilePath) {
            return;
        }

        //Only try to open files open in the editor
        var editor = window.activeTextEditor;
        if(!editor || !editor.document || editor.document.uri.fsPath != docPath) {
            return;
        }

        this._lastCheckedFilePath = docPath;
        this.tryEditFile(docPath);
    }

    private tryEditFile(docPath: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            //Check if this file is in client root first
            this.fileInClientRoot(docPath).then((inClientRoot) => {
                if(inClientRoot) {
                    return this.fileIsOpened(docPath);
                }
                resolve();
            }).then((isOpened) => {
                //If not opened, open file for edit
                if(!isOpened) {
                    return PerforceCommands.edit(docPath);
                }
                resolve();
            }).then((openedForEdit) => {
                resolve();
            }).catch((reason) => {
                Display.showError(reason.toString());
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
            PerforceCommands.p4delete(uri.fsPath);
        }
    }

    private onFileCreated(uri: Uri) {
        //Only try to add files open in the editor
        var editor = window.activeTextEditor;
        if(editor && editor.document && editor.document.uri.fsPath == uri.fsPath) {
            PerforceCommands.add(uri.fsPath);
        }
    }

    private fileInClientRoot(docPath: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            PerforceService.getClientRoot().then((clientRoot) => {
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

    private fileIsOpened(filePath: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            //opened stdout is set if file open, stderr set if not opened
            PerforceService.executeAsPromise('opened', filePath).then((stdout) => {
                resolve(true);
            }).catch((stderr) => {
                resolve(false);
            });
        });
    }
}
