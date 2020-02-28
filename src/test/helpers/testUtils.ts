import * as path from "path";
import * as vscode from "vscode";
import { Utils } from "../../Utils";
import { Status } from "../../scm/Status";
import { StubFile } from "./StubPerforceModel";

function stdout(out: string): [string, string] {
    return [out, ""];
}

function stderr(err: string): [string, string] {
    return ["", err];
}

export function returnStdOut(out: string) {
    return () => stdout(out);
}

export function returnStdErr(err: string) {
    return () => stderr(err);
}

export function getStatusText(status: Status): string {
    switch (status) {
        case Status.ADD:
            return "add";
        case Status.ARCHIVE:
            return "archive";
        case Status.BRANCH:
            return "branch";
        case Status.DELETE:
            return "delete";
        case Status.EDIT:
            return "edit";
        case Status.IMPORT:
            return "import";
        case Status.INTEGRATE:
            return "integrate";
        case Status.LOCK:
            return "lock";
        case Status.MOVE_ADD:
            return "move/add";
        case Status.MOVE_DELETE:
            return "move/delete";
        case Status.PURGE:
            return "purge";
        case Status.UNKNOWN:
            return "???";
    }
}

export function getWorkspaceUri() {
    if (!vscode.workspace.workspaceFolders) {
        throw new Error("No workspace folders open");
    }
    return vscode.workspace.workspaceFolders[0].uri;
}

export function getLocalFile(workspace: vscode.Uri, ...relativePath: string[]) {
    return vscode.Uri.file(path.resolve(workspace.fsPath, ...relativePath));
}

/**
 * Matches against a perforce URI, containing a local file's path
 * @param file
 */
export function perforceLocalUriMatcher(file: StubFile) {
    if (!file.localFile) {
        throw new Error("Can't make a local file matcher without a local file");
    }
    return Utils.makePerforceDocUri(file.localFile, "print", "-q", {
        workspace: getWorkspaceUri().fsPath
    }).with({ fragment: file.depotRevision.toString() });
}

/**
 * Matches against a perforce URI, using the depot path for a file
 * @param file
 */
export function perforceDepotUriMatcher(file: StubFile) {
    return Utils.makePerforceDocUri(
        vscode.Uri.parse("perforce:" + file.depotPath),
        "print",
        "-q",
        { depot: true, workspace: getWorkspaceUri().fsPath }
    ).with({ fragment: file.depotRevision.toString() });
}

/**
 * Matches against a perforce URI, using the resolveBaseFile0 depot path
 * @param file
 */
export function perforceFromFileUriMatcher(file: StubFile) {
    return Utils.makePerforceDocUri(
        vscode.Uri.parse("perforce:" + file.resolveFromDepotPath),
        "print",
        "-q",
        { depot: true, workspace: getWorkspaceUri().fsPath }
    ).with({ fragment: file.resolveEndFromRev?.toString() });
}

/**
 * Matches against a perforce URI, using the depot path for the file AND containing a fragment for the shelved changelist number
 * @param file
 * @param chnum
 */
export function perforceShelvedUriMatcher(file: StubFile, chnum: string) {
    return Utils.makePerforceDocUri(
        vscode.Uri.parse("perforce:" + file.depotPath).with({
            fragment: "@=" + chnum
        }),
        "print",
        "-q",
        { depot: true, workspace: getWorkspaceUri().fsPath }
    );
}

export function perforceLocalShelvedUriMatcher(file: StubFile, chnum: string) {
    if (!file.localFile) {
        throw new Error("Can't make a local file matcher without a local file");
    }
    return Utils.makePerforceDocUri(
        file.localFile.with({ fragment: "@=" + chnum }),
        "print",
        "-q",
        { workspace: getWorkspaceUri().fsPath }
    );
}
