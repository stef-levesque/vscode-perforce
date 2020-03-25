import { Display, ActiveStatusEvent, ActiveEditorStatus } from "./Display";
import * as vscode from "vscode";
import * as PerforceUri from "./PerforceUri";

const makeDefault = () => {
    return {
        status: "",
        depotPath: "",
        revision: "",
        changelist: "",
        operation: "",
        filetype: "",
        message: "",
        showDiffPrev: false,
        showDiffNext: false,
        canDiffPrev: false,
        canDiffNext: false,
        isPerforceOrDiff: false
    };
};

type ContextVars = Record<keyof ReturnType<typeof makeDefault>, string | boolean>;

export function initialize(subscriptions: vscode.Disposable[]) {
    subscriptions.push(Display.onActiveFileStatusKnown(setContextVars));
    subscriptions.push(Display.onActiveFileStatusCleared(clearContextVars));
    subscriptions.push(...Object.keys(makeDefault()).map(registerContextVar));
}

function registerContextVar(name: string) {
    return vscode.commands.registerCommand("perforce.currentFile." + name, () =>
        getFileContext(name as keyof ContextVars)
    );
}

let fileContext: ContextVars = makeDefault();

function getFileContext(arg: keyof ContextVars) {
    return fileContext[arg] ?? "";
}

function isPerforceDoc(file?: vscode.Uri) {
    return !!file && file.scheme === "perforce";
}

function isRightDiffWindow(file?: vscode.Uri) {
    return !!file && !!PerforceUri.decodeUriQuery(file.query).leftUri;
}

function getRevision(file?: vscode.Uri) {
    if (!file) {
        return -1;
    }
    const fileRev = parseInt(file.fragment);
    if (isNaN(fileRev)) {
        return -1;
    }
    return fileRev;
}

function calculateDiffOptions(file?: vscode.Uri, status?: ActiveEditorStatus) {
    const isRightWindow = isRightDiffWindow(file);
    // show diff buttons for all perforce files, all diff windows and anything that is NOT 'not in workspace'

    const isPerforceOrDiff = isRightWindow || isPerforceDoc(file);

    const isNotUnknown =
        status === ActiveEditorStatus.NOT_OPEN || status === ActiveEditorStatus.OPEN;
    const showDiffPrev = isNotUnknown || isPerforceOrDiff;

    const rev = getRevision(file);

    // show next diff button only for diffs (including diffs without a revision - for consistent button placement)
    const showDiffNext = showDiffPrev && (rev >= 0 || isRightWindow);

    const disableDiffPrev =
        (isPerforceDoc && rev === 1) || (isRightWindow && rev <= 2 && rev > 0);
    const disableDiffNext = isRightDiffWindow && rev <= 0;

    return {
        showDiffNext,
        showDiffPrev,
        canDiffNext: !disableDiffNext,
        canDiffPrev: !disableDiffPrev,
        isPerforceOrDiff
    };
}

function setContextVars(event: ActiveStatusEvent) {
    const diffOptions = calculateDiffOptions(event.file, event.status);

    fileContext = {
        status: event.status.toString(),
        depotPath: event.details?.depotPath ?? "",
        revision: event.details?.revision ?? "",
        changelist: event.details?.chnum ?? "",
        operation: event.details?.operation ?? "",
        filetype: event.details?.filetype ?? "",
        message: event.details?.message ?? "",
        ...diffOptions
    };

    Object.entries(fileContext).forEach(c => {
        vscode.commands.executeCommand(
            "setContext",
            "perforce.currentFile." + c[0],
            c[1]
        );
    });
}

function clearContextVars(file?: vscode.Uri) {
    fileContext = makeDefault();

    const diffOptions = calculateDiffOptions(file);

    const all = { ...fileContext, ...diffOptions };

    Object.entries(all).forEach(c => {
        vscode.commands.executeCommand(
            "setContext",
            "perforce.currentFile." + c[0],
            c[1]
        );
    });
}
