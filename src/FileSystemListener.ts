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

import {Display} from './Display';
import {PerforceCommands} from './PerforceCommands';
import {PerforceService} from './PerforceService';

export default class FileSystemListener
{
    private _disposable: Disposable;
    private _watcher: FileSystemWatcher;

    private _lastCheckedFilePath: string;

    constructor() {
        const subscriptions: Disposable[] = [];
        window.onDidChangeActiveTextEditor(Display.updateEditor, this, subscriptions);

        var config = workspace.getConfiguration('perforce');

        if(config && PerforceCommands.checkFolderOpened()) {
            if(config['editOnFileSave']) {
                workspace.onDidSaveTextDocument(this.onFileSaved, this, subscriptions);
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

        this._disposable = Disposable.from.apply(this, subscriptions);
    }

    public dispose() {
        this._disposable.dispose();
    }

    private onFileSaved(doc: TextDocument) {
        this.tryEditFile(doc.uri.fsPath);
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

    private tryEditFile(docPath: string): void {
        //Check if this file is in client root first
        this.fileInClientRoot(docPath).then((inClientRoot) => {
            if(inClientRoot) {
                return this.fileIsOpened(docPath);
            }
        }).then((isOpened) => {
            //If not opened, open file for edit
            if(!isOpened) {
                PerforceCommands.edit(docPath);
            }
        }).catch((err) => {
            console.log(err);
            Display.showError(err);
        });
    }

    private onFileDeleted(uri: Uri) {
        PerforceCommands.p4delete(uri.fsPath);
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