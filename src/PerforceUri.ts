import * as vscode from "vscode";

export type UriArguments = {
    workspace?: string;
    depot?: boolean;
    command?: string;
    p4Args?: string;
    leftUri?: string;
    haveRev?: string;
    diffStartFile?: string;
};

type AnyUriArguments = {
    [key: string]: string | boolean | undefined;
};

export function getDepotPathFromDepotUri(uri: vscode.Uri): string {
    return "//" + uri.authority + uri.path;
}

function encodeParam(param: string, value?: string | boolean) {
    if (value !== undefined && typeof value === "string") {
        return encodeURIComponent(param) + "=" + encodeURIComponent(value);
    } else if (value === undefined || value) {
        return encodeURIComponent(param);
    }
}

/*
export function fromFsOrDepotPath(
    workspace: vscode.Uri,
    fsOrDepotPath: string,
    revision: string | undefined,
    isDepotPath: boolean
) {
    return isDepotPath ? fromDepotPath(workspace, fsOrDepotPath, revision) : fromUr;
}
*/

export function fromDepotPath(
    workspace: vscode.Uri,
    depotPath: string,
    revisionOrAtLabel: string | undefined
) {
    const baseUri = vscode.Uri.parse("perforce:" + depotPath).with({
        fragment: revisionOrAtLabel
    });
    return fromUri(baseUri, {
        depot: true,
        workspace: workspace.fsPath
    });
}

function hasTruthyArg(uri: vscode.Uri, arg: keyof UriArguments): boolean {
    return !!decodeUriQuery(uri.query)[arg];
}

export function isDepotUri(uri: vscode.Uri): boolean {
    return hasTruthyArg(uri, "depot");
}

export function isUsableForWorkspace(uri: vscode.Uri): boolean {
    return (!isDepotUri(uri) && !!uri.fsPath) || hasTruthyArg(uri, "workspace");
}

export function getWorkspaceFromQuery(uri: vscode.Uri) {
    const ws = decodeUriQuery(uri.query).workspace;
    return ws ? vscode.Uri.file(ws) : undefined;
}

export function getUsableWorkspace(uri: vscode.Uri) {
    return !isDepotUri(uri) && !!uri.fsPath
        ? vscode.Uri.file(uri.fsPath)
        : getWorkspaceFromQuery(uri);
}

export function forCommand(resource: vscode.Uri, command: string, p4Args: string) {
    return fromUri(vscode.Uri.parse("perforce:"), {
        command: command,
        p4Args: p4Args,
        workspace: resource.fsPath
    });
}

export function fromUri(uri: vscode.Uri, otherArgs?: UriArguments) {
    const defaultArgs = {
        command: "print",
        p4Args: "-q"
    };
    return uri.with({
        scheme: "perforce",
        query: encodeQuery({
            ...defaultArgs,
            ...decodeUriQuery(uri.query), // use existing params
            ...otherArgs
        })
    });
}

export function fromUriWithRevision(perforceUri: vscode.Uri, revisionOrAtLabel: string) {
    return fromUri(perforceUri.with({ fragment: revisionOrAtLabel }));
}

/**
 * Add the supplied arguments to a perforce uri - replacing any that are specified in both objects
 * @param uri the uri to add args to
 * @param args the arguments to add
 */
export function withArgs(
    uri: vscode.Uri,
    args: UriArguments,
    revisionOrAtLabel?: string
) {
    const curArgs = decodeUriQuery(uri.query);
    const newQuery = encodeQuery({
        ...curArgs,
        ...args
    });
    return revisionOrAtLabel !== undefined
        ? uri.with({ query: newQuery, fragment: revisionOrAtLabel })
        : uri.with({ query: newQuery });
}

export function encodeQuery(args: UriArguments) {
    return Object.entries(args)
        .filter(arg => !!arg[1])
        .map(arg => encodeParam(arg[0], arg[1]))
        .filter(arg => !!arg)
        .join("&");
}

export function decodeUriQuery(query: string): UriArguments {
    const argArr = query?.split("&") ?? [];
    const allArgs: AnyUriArguments = {};
    argArr.forEach(arg => {
        const parts = arg.split("=");
        const name = decodeURIComponent(parts[0]);
        const value = parts[1] ? decodeURIComponent(parts[1]) : true;
        allArgs[name as keyof AnyUriArguments] = value;
    });

    // a bit of a hack - could violate the type e.g. if allArgs has a bool for a string type
    return allArgs as UriArguments;
}
