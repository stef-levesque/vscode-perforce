import {
    window, 
    StatusBarAlignment,
    StatusBarItem
} from 'vscode';

import {PerforceService} from './PerforceService';

var _statusBarItem : StatusBarItem;

export namespace Display
{
    export var channel = window.createOutputChannel('Perforce Log');

    export function initialize() {
        _statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
        _statusBarItem.command = 'perforce.menuFunctions';

        updateEditor();
    }

    export function updateEditor() {
        var editor = window.activeTextEditor;
        if(!editor) {
            this.statusBarItem.hide();
            return;
        }

        var doc = editor.document;

        if(!doc.isUntitled) {
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
            });
            _statusBarItem.show();
        } else {
            _statusBarItem.hide();
        }
    }

    export function showError(error: string) {
        channel.show();
        channel.appendLine("ERROR:");
        channel.append(error);
    }

}
