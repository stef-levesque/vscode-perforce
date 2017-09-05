import {
    window, 
    StatusBarAlignment,
    StatusBarItem,
    workspace
} from 'vscode';

import * as Path from 'path';

import { PerforceService } from './PerforceService';
import { Utils } from './Utils';

var _statusBarItem : StatusBarItem;

export namespace Display
{
    export var channel = window.createOutputChannel('Perforce Log');

    export function initialize() {
        _statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, Number.MIN_VALUE);
        _statusBarItem.command = 'perforce.menuFunctions';

        updateEditor();
    }

    export function updateEditor() {
        var editor = window.activeTextEditor;
        if(!editor) {
            _statusBarItem.hide();
            return;
        }

        var doc = editor.document;

        //If no folder is open, override the perforce directory to the files
        var directoryOverride = null;
        if (workspace.rootPath === undefined) {
            directoryOverride = Path.dirname(doc.uri.fsPath);
        }

        if(!doc.isUntitled) {
            const args = '"' + Utils.expansePath(doc.uri.fsPath) + '"';
            PerforceService.execute("opened", function(err, stdout, stderr) {
                if(err) {
                    // file not under client root
                    _statusBarItem.text = 'P4: $(circle-slash)';
                    _statusBarItem.tooltip = stderr.toString();
                }
                else if(stderr) {
                    // file not opened on client
                    _statusBarItem.text = 'P4: $(file-text)';
                    _statusBarItem.tooltip = stderr.toString();
                } else if(stdout) {
                    // file opened in add or edit
                    _statusBarItem.text = 'P4: $(check)';
                    _statusBarItem.tooltip = stdout.toString();
                }
            }, args, directoryOverride);
            _statusBarItem.show();
        } else {
            _statusBarItem.hide();
        }
    }

    export function showMessage(message: string) {
        window.setStatusBarMessage("Perforce: " + message, 3000);
        channel.append(message);
    }

    export function showError(error: string) {
        window.setStatusBarMessage("Perforce: " + error, 3000);
        channel.appendLine(`ERROR: ${JSON.stringify(error)}`);
    }
}
