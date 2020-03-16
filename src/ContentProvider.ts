import { window, workspace, Uri, Disposable, Event, EventEmitter } from "vscode";
import { Utils, UriArguments } from "./Utils";
import { Display } from "./Display";
import { runPerforceCommand, pathsToArgs, isTruthy } from "./api/CommandUtils";

export class PerforceContentProvider {
    private onDidChangeEmitter = new EventEmitter<Uri>();

    get onDidChange(): Event<Uri> {
        return this.onDidChangeEmitter.event;
    }

    private disposables: Disposable[] = [];
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }

    constructor() {
        this.disposables.push(
            workspace.registerTextDocumentContentProvider("perforce", this)
        );
    }

    public requestUpdatedDocument(uri: Uri) {
        this.onDidChangeEmitter.fire(uri);
    }

    private getResourceForUri(uri: Uri, allArgs: UriArguments): Uri | undefined {
        if (allArgs["depot"]) {
            // depot-based uri should always have a path
            const resource =
                allArgs["workspace"] && typeof (allArgs["workspace"] === "string")
                    ? Uri.file(allArgs["workspace"] as string)
                    : workspace.workspaceFolders?.[0].uri;
            return resource;
        }
        if (uri.fsPath) {
            // a file is supplied
            const resource = Uri.file(uri.fsPath);
            return resource;
        }
        // just for printing the output of a command that doesn't relate to a specific file
        if (window.activeTextEditor && !window.activeTextEditor.document.isUntitled) {
            return window.activeTextEditor.document.uri;
        }
        return workspace.workspaceFolders?.[0].uri;
    }

    public async provideTextDocumentContent(uri: Uri): Promise<string> {
        if (uri.path === "EMPTY") {
            return "";
        }

        const allArgs = Utils.decodeUriQuery(uri.query ?? "");
        const args = ((allArgs["p4args"] as string) ?? "-q").split(" ");
        const command = (allArgs["command"] as string) ?? "print";

        const resource = this.getResourceForUri(uri, allArgs);

        if (!resource) {
            Display.channel.appendLine(
                `Can't find proper workspace to provide content for ${uri}`
            );
            throw new Error(`Can't find proper workspace for command ${command} `);
        }

        // TODO - don't export this stuff from the API,
        // change the uri scheme so that it's not just running arbitrary commands
        const fileArgs = uri.fsPath ? pathsToArgs([uri]).filter(isTruthy) : [];
        const allP4Args = args.concat(fileArgs);

        return runPerforceCommand(resource, command, allP4Args, { hideStdErr: true });
    }
}
