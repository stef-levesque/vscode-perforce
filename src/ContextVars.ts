import { Display, ActiveStatusEvent } from "./Display";
import * as vscode from "vscode";

const makeDefault = () => {
    return {
        status: "",
        depotPath: "",
        revision: "",
        changelist: "",
        operation: "",
        filetype: "",
        message: ""
    };
};

type ContextVars = Record<keyof ReturnType<typeof makeDefault>, string>;

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

function setContextVars(event: ActiveStatusEvent) {
    fileContext = {
        status: event.status.toString(),
        depotPath: event.details?.depotPath ?? "",
        revision: event.details?.revision ?? "",
        changelist: event.details?.chnum ?? "",
        operation: event.details?.operation ?? "",
        filetype: event.details?.filetype ?? "",
        message: event.details?.message ?? ""
    };

    Object.entries(fileContext).forEach(c => {
        vscode.commands.executeCommand(
            "setContext",
            "perforce.currentFile." + c[0],
            c[1]
        );
    });
}

function clearContextVars() {
    vscode.commands.executeCommand("setContext", "perforce.currentFile.status", "");

    fileContext = makeDefault();

    Object.keys(fileContext).forEach(c => {
        vscode.commands.executeCommand(
            "setContext",
            "perforce.currentFile." + c,
            undefined
        );
    });
}
