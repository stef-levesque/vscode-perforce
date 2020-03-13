import { commands, window, Uri, workspace } from "vscode";
import { Resource } from "./scm/Resource";
import { Status } from "./scm/Status";
import { Utils } from "./Utils";
import { FileType } from "./scm/FileTypes";
import * as Path from "path";
import * as fs from "fs";

export enum DiffType {
    WORKSPACE_V_DEPOT,
    SHELVE_V_DEPOT,
    WORKSPACE_V_SHELVE
}

function findLengthOfCommonPrefix(sa: string, sb: string) {
    const i = sa.split("").findIndex((a, i) => a !== sb[i]);
    return i;
}

function getUnprefixedName(file: string, prefixLength: number) {
    return prefixLength <= 0 ? Path.basename(file) : file.slice(prefixLength);
}

export function getPathsWithoutCommonPrefix(a: string, b: string): [string, string] {
    const prefixLen = findLengthOfCommonPrefix(a, b);
    return [getUnprefixedName(a, prefixLen), getUnprefixedName(b, prefixLen)];
}

export function diffTitleForDepotPaths(
    leftPath: string,
    leftRevision: string,
    rightPath: string,
    rightRevision: string
) {
    const [leftTitle, rightTitle] = getPathsWithoutCommonPrefix(leftPath, rightPath);
    return leftTitle + "#" + leftRevision + " ⟷ " + rightTitle + "#" + rightRevision;
}

export async function diffFiles(leftFile: Uri, rightFile: Uri) {
    const leftPath = Utils.getDepotPathFromDepotUri(leftFile);
    const rightPath = Utils.getDepotPathFromDepotUri(rightFile);

    const fullTitle = diffTitleForDepotPaths(
        leftPath,
        leftFile.fragment,
        rightPath,
        rightFile.fragment
    );

    await commands.executeCommand<void>("vscode.diff", leftFile, rightFile, fullTitle);
}

export async function diffDefault(
    resource: Resource,
    diffType?: DiffType
): Promise<void> {
    if (resource.FileType.base === FileType.BINARY) {
        const uri = Utils.makePerforceDocUri(resource.resourceUri, "fstat", "");
        await workspace.openTextDocument(uri).then(doc => window.showTextDocument(doc));
        return;
    }

    if (diffType === undefined) {
        diffType = resource.isShelved
            ? DiffType.SHELVE_V_DEPOT
            : DiffType.WORKSPACE_V_DEPOT;
    }

    const left = getLeftResource(resource, diffType);
    const right = getRightResource(resource, diffType);

    if (!left) {
        if (!right) {
            // TODO
            console.error("Status not supported: " + resource.status.toString());
            return;
        }
        await window.showTextDocument(right);
        return;
    }
    if (!right) {
        await window.showTextDocument(left.uri);
        return;
    }
    await commands.executeCommand<void>(
        "vscode.diff",
        left.uri,
        right,
        getTitle(resource, left.title, diffType)
    );
    return;
}

// Gets the uri for the previous version of the file.
function getLeftResource(
    resource: Resource,
    diffType: DiffType
): { title: string; uri: Uri } | undefined {
    const args = {
        depot: resource.isShelved,
        workspace: resource.model.workspaceUri.fsPath
    };

    if (diffType === DiffType.WORKSPACE_V_SHELVE) {
        // left hand side is the shelve
        switch (resource.status) {
            case Status.ADD:
            case Status.EDIT:
            case Status.INTEGRATE:
            case Status.MOVE_ADD:
            case Status.BRANCH:
                return {
                    title:
                        Path.basename(resource.resourceUri.fsPath) +
                        "@=" +
                        resource.change,
                    uri: resource.resourceUri.with({
                        scheme: "perforce",
                        query: Utils.makePerforceUriQuery("print", "-q", args),
                        fragment: "@=" + resource.change
                    })
                };
            case Status.DELETE:
            case Status.MOVE_DELETE:
        }
    } else {
        const emptyDoc = Uri.parse("perforce:EMPTY");
        // left hand side is the depot version
        switch (resource.status) {
            case Status.ADD:
            case Status.BRANCH:
                return {
                    title: Path.basename(resource.resourceUri.fsPath) + "#0",
                    uri: emptyDoc
                };
            case Status.MOVE_ADD:
                // diff against the old file if it is known (always a depot path)
                return {
                    title: resource.fromFile
                        ? Path.basename(resource.fromFile.fsPath) +
                          "#" +
                          resource.fromEndRev
                        : "Depot Version",
                    uri: resource.fromFile
                        ? Utils.makePerforceDocUri(resource.fromFile, "print", "-q", {
                              depot: true,
                              workspace: resource.model.workspaceUri.fsPath
                          }).with({ fragment: resource.fromEndRev })
                        : emptyDoc
                };
            case Status.INTEGRATE:
            case Status.EDIT:
            case Status.DELETE:
            case Status.MOVE_DELETE:
                return {
                    title:
                        Path.basename(resource.resourceUri.fsPath) +
                        "#" +
                        resource.workingRevision,
                    uri: Utils.makePerforceDocUri(
                        resource.resourceUri,
                        "print",
                        "-q",
                        args
                    ).with({ fragment: resource.workingRevision })
                };
        }
    }
}

// Gets the uri for the current version of the file (or the shelved version depending on the diff type).
function getRightResource(resource: Resource, diffType: DiffType): Uri | undefined {
    const emptyDoc = Uri.parse("perforce:EMPTY");
    if (diffType === DiffType.SHELVE_V_DEPOT) {
        const args = {
            depot: resource.isShelved,
            workspace: resource.model.workspaceUri.fsPath
        };

        switch (resource.status) {
            case Status.ADD:
            case Status.EDIT:
            case Status.MOVE_ADD:
            case Status.INTEGRATE:
            case Status.BRANCH:
                return resource.resourceUri.with({
                    scheme: "perforce",
                    query: Utils.makePerforceUriQuery("print", "-q", args),
                    fragment: "@=" + resource.change
                });
        }
    } else {
        const exists =
            !resource.isShelved ||
            (resource.underlyingUri && fs.existsSync(resource.underlyingUri.fsPath));
        switch (resource.status) {
            case Status.ADD:
            case Status.EDIT:
            case Status.MOVE_ADD:
            case Status.INTEGRATE:
            case Status.BRANCH:
                return exists ? resource.underlyingUri ?? emptyDoc : emptyDoc;
        }
    }
}

function getTitle(resource: Resource, leftTitle: string, diffType: DiffType): string {
    const basename = Path.basename(resource.resourceUri.fsPath);

    let text = "";
    switch (diffType) {
        case DiffType.SHELVE_V_DEPOT:
            text = leftTitle + " vs " + basename + "@=" + resource.change;
            break;
        case DiffType.WORKSPACE_V_SHELVE:
            text = leftTitle + " vs " + basename + " (workspace)";
            break;
        case DiffType.WORKSPACE_V_DEPOT:
            text = leftTitle + " vs " + basename + " (workspace)";
    }
    return text;
}
