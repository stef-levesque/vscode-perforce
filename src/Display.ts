import {
    window,
    StatusBarAlignment,
    StatusBarItem,
    EventEmitter,
    Uri,
    commands
} from "vscode";

import { PerforceService } from "./PerforceService";
import { Utils } from "./Utils";
import { debounce } from "./Debounce";

let _statusBarItem: StatusBarItem;

export enum ActiveEditorStatus {
    OPEN,
    NOT_OPEN,
    NOT_IN_WORKSPACE
}

export interface ActiveStatusEvent {
    file: Uri;
    status: ActiveEditorStatus;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Display {
    export const channel = window.createOutputChannel("Perforce Log");

    const _onActiveFileStatusKnown = new EventEmitter<ActiveStatusEvent>();
    export const onActiveFileStatusKnown = _onActiveFileStatusKnown.event;
    let _initialisedChannel = false;

    export const updateEditor = debounce(updateEditorImpl, 1000, () => {
        if (_statusBarItem) {
            _statusBarItem.text = "P4: $(sync)";
            _statusBarItem.tooltip = "Checking file status";
        }
    });

    export function initialize(subscriptions: { dispose(): any }[]) {
        _statusBarItem = window.createStatusBarItem(
            StatusBarAlignment.Left,
            Number.MIN_VALUE
        );
        _statusBarItem.command = "perforce.menuFunctions";
        subscriptions.push(_statusBarItem);
        subscriptions.push(_onActiveFileStatusKnown);

        updateEditor();
    }

    export function initializeChannel(subscriptions: { dispose(): any }[]) {
        if (!_initialisedChannel) {
            _initialisedChannel = true;
            subscriptions.push(
                commands.registerCommand("perforce.showOutput", showOutput)
            );
            subscriptions.push(channel);
        }
    }

    function showOutput() {
        Display.channel.show();
    }

    function updateEditorImpl() {
        const editor = window.activeTextEditor;
        if (!editor) {
            if (_statusBarItem) {
                _statusBarItem.hide();
            }
            return;
        }

        const doc = editor.document;

        if (!doc.isUntitled) {
            const args = [Utils.expansePath(doc.uri.fsPath)];
            PerforceService.execute(
                doc.uri,
                "opened",
                function(err, stdout, stderr) {
                    let active: ActiveEditorStatus = ActiveEditorStatus.NOT_IN_WORKSPACE;
                    if (err) {
                        // file not under client root
                        _statusBarItem.text = "P4: $(circle-slash)";
                        _statusBarItem.tooltip = stderr.toString();
                        active = ActiveEditorStatus.NOT_IN_WORKSPACE;
                    } else if (stderr) {
                        // file not opened on client
                        _statusBarItem.text = "P4: $(file-text)";
                        _statusBarItem.tooltip = stderr.toString();
                        active = ActiveEditorStatus.NOT_OPEN;
                    } else if (stdout) {
                        // file opened in add or edit
                        _statusBarItem.text = "P4: $(check)";
                        _statusBarItem.tooltip = stdout.toString();
                        active = ActiveEditorStatus.OPEN;
                    }

                    _onActiveFileStatusKnown.fire({ file: doc.uri, status: active });
                },
                args
            );
            _statusBarItem.show();
        } else {
            _statusBarItem.hide();
        }
    }

    export function showMessage(message: string) {
        window.setStatusBarMessage("Perforce: " + message, 3000);
        channel.append(message + "\n");
    }

    export function showModalMessage(message: string) {
        window.showInformationMessage(message, { modal: true });
    }

    export function showError(error: string) {
        window.setStatusBarMessage("Perforce: " + error, 3000);
        channel.appendLine(`ERROR: ${JSON.stringify(error)}`);
    }

    export function showImportantError(error: string) {
        window.showErrorMessage(error);
        channel.appendLine(`ERROR: ${JSON.stringify(error)}`);
    }
}
