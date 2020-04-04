import { commands, window, Uri, workspace } from "vscode";
import { Resource } from "./scm/Resource";
import { Status } from "./scm/Status";
import { FileType } from "./scm/FileTypes";
import { Display } from "./Display";
import * as Path from "path";
import * as fs from "fs";
import * as PerforceUri from "./PerforceUri";
import * as p4 from "./api/PerforceApi";

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
    return (
        leftTitle +
        "#" +
        leftRevision +
        " ⟷ " +
        rightTitle +
        (rightRevision ? "#" + rightRevision : "")
    );
}

function diffTitleForFiles(leftFile: Uri, rightFile: Uri) {
    if (!PerforceUri.isDepotUri(rightFile)) {
        return (
            Path.basename(leftFile.fsPath) +
            "#" +
            leftFile.fragment +
            " ⟷ " +
            Path.basename(rightFile.fsPath) +
            (rightFile.fragment ? "#" + rightFile.fragment : " (workspace)")
        );
    }
    const leftPath = PerforceUri.getDepotPathFromDepotUri(leftFile);
    const rightPath = PerforceUri.getDepotPathFromDepotUri(rightFile);

    return diffTitleForDepotPaths(
        leftPath,
        leftFile.fragment,
        rightPath,
        rightFile.fragment
    );
}

export async function diffFiles(leftFile: Uri, rightFile: Uri, title?: string) {
    // ensure we don't keep stacking left files
    const leftFileWithoutLeftFiles = PerforceUri.withArgs(leftFile, {
        leftUri: undefined
    });
    const gotStartFile =
        PerforceUri.decodeUriQuery(rightFile.query).diffStartFile ??
        PerforceUri.decodeUriQuery(leftFile.query).diffStartFile;

    const rightUriWithLeftInfo = PerforceUri.withArgs(rightFile, {
        leftUri: leftFileWithoutLeftFiles.toString(),
        diffStartFile: gotStartFile ?? rightFile.toString()
    });

    const fullTitle = title ?? diffTitleForFiles(leftFile, rightFile);

    await commands.executeCommand<void>(
        "vscode.diff",
        leftFileWithoutLeftFiles,
        rightUriWithLeftInfo,
        fullTitle
    );
}

function getPreviousUri(fromUri: Uri) {
    if (!fromUri.fragment) {
        return undefined;
    }
    const rightRev = parseInt(fromUri.fragment);
    if (isNaN(rightRev)) {
        return undefined;
    }
    if (rightRev <= 1) {
        return undefined;
    }
    return fromUri.with({ fragment: (rightRev - 1).toString() });
}

/**
 * Diffs a URI with a revision number against a URI with the previous revision number (provided it is > 0)
 * @param rightUri
 */
async function diffPreviousFrom(rightUri?: Uri) {
    if (!rightUri) {
        Display.showImportantError("No previous revision available");
        return;
    }
    const leftUri = getPreviousUri(rightUri);
    if (!leftUri) {
        Display.showImportantError("No previous revision available");
        return;
    }
    await diffFiles(leftUri, rightUri);
}

/**
 * Work out the have revision for the file, and diff the working file against that revision
 */
async function diffPreviousFromWorking(fromDoc: Uri) {
    const leftUri = (await p4.have(fromDoc, { file: fromDoc }))?.depotUri;
    if (!leftUri) {
        Display.showImportantError("No previous revision available");
        return;
    }
    await diffFiles(
        PerforceUri.withArgs(leftUri, { haveRev: leftUri.fragment }),
        PerforceUri.withArgs(fromDoc, { haveRev: leftUri.fragment })
    );
}

/**
 * Use the information provided in the right hand URI, about the left hand file, to perform the diff, if possible
 * @param fromDoc the current right hand URI
 * @returns a promise if the diff is possible, or false otherwise
 */
function diffPreviousUsingLeftInfo(fromDoc: Uri): boolean | Promise<void> {
    const args = PerforceUri.decodeUriQuery(fromDoc.query);
    const workspace = PerforceUri.getUsableWorkspace(fromDoc);
    if (!workspace) {
        throw new Error("No usable workspace found for " + fromDoc);
    }
    if (!args.leftUri) {
        return false;
    }
    const rightUri = PerforceUri.withArgs(Uri.parse(args.leftUri), {
        diffStartFile: args.diffStartFile
    });
    return diffPreviousFrom(rightUri);
}

async function diffPreviousUsingRevision(fromDoc: Uri) {
    const rev = parseInt(fromDoc.fragment);
    if (isNaN(rev)) {
        await diffPreviousFromWorking(fromDoc);
    } else {
        await diffPreviousFrom(fromDoc);
    }
}

/**
 * Diffs against the fromDoc's previous revision, regardless of whether
 * the supplied URI is the right hand of a diff
 * @param fromDoc the Uri to diff
 */
export async function diffPreviousIgnoringLeftInfo(fromDoc: Uri) {
    await diffPreviousUsingRevision(fromDoc);
}

export async function diffPrevious(fromDoc: Uri) {
    const usingLeftInfo = diffPreviousUsingLeftInfo(fromDoc);
    if (usingLeftInfo) {
        await usingLeftInfo;
    } else {
        await diffPreviousUsingRevision(fromDoc);
    }
}

export async function diffNext(fromDoc: Uri) {
    const rev = parseInt(fromDoc.fragment);
    if (isNaN(rev)) {
        Display.showImportantError("No more revisions available");
        return;
    }

    const leftUri = fromDoc;

    const args = PerforceUri.decodeUriQuery(fromDoc.query);
    const atHaveRev = args.haveRev && parseInt(args.haveRev) === rev;
    const rightUri =
        atHaveRev && args.diffStartFile
            ? Uri.parse(args.diffStartFile)
            : fromDoc.with({ fragment: (rev + 1).toString() });

    await diffFiles(leftUri, rightUri);
}

export async function diffDefault(
    resource: Resource,
    diffType?: DiffType
): Promise<void> {
    if (resource.FileType.base === FileType.BINARY) {
        const uri = PerforceUri.fromUri(resource.resourceUri, { command: "fstat" });
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

    const leftUri = PerforceUri.withArgs(left.uri, {
        haveRev: resource.workingRevision
    });
    const rightUri = PerforceUri.withArgs(right, {
        haveRev: resource.workingRevision
    });
    await diffFiles(leftUri, rightUri, getTitle(resource, left.title, diffType));
    return;
}

// Gets the uri for the previous version of the file.
function getLeftResource(
    resource: Resource,
    diffType: DiffType
): { title: string; uri: Uri } | undefined {
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
                    uri: PerforceUri.fromUriWithRevision(
                        resource.resourceUri,
                        "@=" + resource.change
                    )
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
                    uri: resource.fromFile ?? emptyDoc
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
                    uri: PerforceUri.fromUriWithRevision(
                        resource.resourceUri,
                        resource.workingRevision
                    )
                };
        }
    }
}

// Gets the uri for the current version of the file (or the shelved version depending on the diff type).
function getRightResource(resource: Resource, diffType: DiffType): Uri | undefined {
    const emptyDoc = Uri.parse("perforce:EMPTY");
    if (diffType === DiffType.SHELVE_V_DEPOT) {
        switch (resource.status) {
            case Status.ADD:
            case Status.EDIT:
            case Status.MOVE_ADD:
            case Status.INTEGRATE:
            case Status.BRANCH:
                return resource.resourceUri;
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
            text = leftTitle + " ⟷ " + basename + "@=" + resource.change;
            break;
        case DiffType.WORKSPACE_V_SHELVE:
            text = leftTitle + " ⟷ " + basename + " (workspace)";
            break;
        case DiffType.WORKSPACE_V_DEPOT:
            text = leftTitle + " ⟷ " + basename + " (workspace)";
    }
    return text;
}
