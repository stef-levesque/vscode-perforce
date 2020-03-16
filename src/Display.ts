import {
    window,
    StatusBarAlignment,
    StatusBarItem,
    EventEmitter,
    Uri,
    commands
} from "vscode";

import { debounce } from "./Debounce";
import * as p4 from "./api/PerforceApi";

let _statusBarItem: StatusBarItem;

export enum ActiveEditorStatus {
    OPEN = "OPEN",
    NOT_OPEN = "NOT_OPEN",
    NOT_IN_WORKSPACE = "NOT_IN_WORKSPACE"
}

export interface ActiveStatusEvent {
    file: Uri;
    status: ActiveEditorStatus;
    details?: p4.OpenedFile;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Display {
    export const channel = window.createOutputChannel("Perforce Log");

    const _onActiveFileStatusKnown = new EventEmitter<ActiveStatusEvent>();
    export const onActiveFileStatusKnown = _onActiveFileStatusKnown.event;
    const _onActiveFileStatusCleared = new EventEmitter<void>();
    export const onActiveFileStatusCleared = _onActiveFileStatusCleared.event;
    let _initialisedChannel = false;

    export const updateEditor = debounce(updateEditorImpl, 1000, () => {
        _onActiveFileStatusCleared.fire();
        if (_statusBarItem) {
            _statusBarItem.show();
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

    async function updateEditorImpl() {
        const editor = window.activeTextEditor;
        if (!editor) {
            if (_statusBarItem) {
                _statusBarItem.hide();
            }
            return;
        }

        const doc = editor.document;

        if (!doc.isUntitled) {
            let active: ActiveEditorStatus = ActiveEditorStatus.NOT_IN_WORKSPACE;
            let details: p4.OpenedFile | undefined;
            try {
                const opened = await p4.getOpenedFileDetails(doc.uri, {
                    files: [doc.uri]
                });
                if (opened.open.length > 0) {
                    _statusBarItem.text = "P4: $(check)";
                    _statusBarItem.tooltip = opened.open[0].message;
                    active = ActiveEditorStatus.OPEN;
                    details = opened.open[0];
                } else if (opened.unopen.length > 0) {
                    const inRoot =
                        opened.unopen[0].reason === p4.UnopenedFileReason.NOT_OPENED;
                    _statusBarItem.text = inRoot
                        ? "P4: $(file-text)"
                        : "P4: $(circle-slash)";
                    _statusBarItem.tooltip = opened.unopen[0].message;
                    active = inRoot
                        ? ActiveEditorStatus.NOT_OPEN
                        : ActiveEditorStatus.NOT_IN_WORKSPACE;
                }
            } catch (err) {
                // file not under client root
                _statusBarItem.text = "P4: $(circle-slash)";
                _statusBarItem.tooltip = err.toString();
                active = ActiveEditorStatus.NOT_IN_WORKSPACE;
            }

            _onActiveFileStatusKnown.fire({ file: doc.uri, status: active, details });
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
