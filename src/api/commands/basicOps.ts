import { flagMapper, makeSimpleCommand, asyncOuputHandler } from "../CommandUtils";
import { PerforceFile, NoOpts } from "../CommonTypes";
import * as vscode from "vscode";
import * as PerforceUri from "../../PerforceUri";
import { isTruthy } from "../../TsUtils";

export type DeleteChangelistOptions = {
    chnum: string;
};

const deleteChangelistFlags = flagMapper<DeleteChangelistOptions>([["d", "chnum"]]);

export const deleteChangelist = makeSimpleCommand("change", deleteChangelistFlags);

export type SubmitChangelistOptions = {
    chnum?: string;
    description?: string;
    file?: PerforceFile;
};

const submitFlags = flagMapper<SubmitChangelistOptions>(
    [
        ["c", "chnum"],
        ["d", "description"]
    ],
    "file"
);

const submitChangelistCommand = makeSimpleCommand("submit", submitFlags);

function parseSubmitOutput(output: string) {
    const matches = /Change (\d+) submitted/.exec(output);
    return {
        rawOutput: output,
        chnum: matches?.[1]
    };
}

export const submitChangelist = asyncOuputHandler(
    submitChangelistCommand,
    parseSubmitOutput
);

export interface RevertOptions {
    paths: PerforceFile[];
    chnum?: string;
    unchanged?: boolean;
}

const revertFlags = flagMapper<RevertOptions>(
    [
        ["a", "unchanged"],
        ["c", "chnum"]
    ],
    "paths"
);

export const revert = makeSimpleCommand("revert", revertFlags);

export interface DeleteOptions {
    chnum?: string;
    paths: PerforceFile[];
}

const deleteFlags = flagMapper<DeleteOptions>([["c", "chnum"]], "paths");

export const del = makeSimpleCommand("delete", deleteFlags);

//#region Shelving

export interface ShelveOptions {
    chnum?: string;
    force?: boolean;
    delete?: boolean;
    paths?: PerforceFile[];
}

const shelveFlags = flagMapper<ShelveOptions>(
    [
        ["f", "force"],
        ["d", "delete"],
        ["c", "chnum"]
    ],
    "paths"
);

export const shelve = makeSimpleCommand("shelve", shelveFlags);

export interface UnshelveOptions {
    shelvedChnum: string;
    toChnum?: string;
    force?: boolean;
    paths?: PerforceFile[];
}

const unshelveFlags = flagMapper<UnshelveOptions>(
    [
        ["f", "force"],
        ["s", "shelvedChnum"],
        ["c", "toChnum"]
    ],
    "paths"
);

export const unshelve = makeSimpleCommand("unshelve", unshelveFlags);

//#endregion

export interface FixJobOptions {
    chnum: string;
    jobId: string;
    removeFix?: boolean;
}

const fixJobFlags = flagMapper<FixJobOptions>(
    [
        ["c", "chnum"],
        ["d", "removeFix"]
    ],
    "jobId"
);

export const fixJob = makeSimpleCommand("fix", fixJobFlags);

export interface ReopenOptions {
    chnum: string;
    files: PerforceFile[];
}

const reopenFlags = flagMapper<ReopenOptions>([["c", "chnum"]], "files");

export const reopenFiles = makeSimpleCommand("reopen", reopenFlags);

export interface SyncOptions {
    files?: PerforceFile[];
}

const syncFlags = flagMapper<SyncOptions>([], "files");

export const sync = makeSimpleCommand("sync", syncFlags);

function parseInfo(output: string): Map<string, string> {
    const map = new Map<string, string>();
    const lines = output.trim().split(/\r?\n/);

    for (let i = 0, n = lines.length; i < n; ++i) {
        // Property Name: Property Value
        const matches = /([^:]+): (.+)/.exec(lines[i]);

        if (matches) {
            map.set(matches[1], matches[2]);
        }
    }

    return map;
}

export const info = makeSimpleCommand("info", () => []);

export const getInfo = asyncOuputHandler(info, parseInfo);

export interface HaveFileOptions {
    file: PerforceFile;
}

const haveFileFlags = flagMapper<HaveFileOptions>([], "file", [], {
    ignoreRevisionFragments: true
});

export type HaveFile = {
    depotPath: string;
    revision: string;
    depotUri: vscode.Uri;
    localUri: vscode.Uri;
};

function parseHaveOutput(resource: vscode.Uri, output: string): HaveFile | undefined {
    const matches = /^(.+)#(\d+) - (.+)/.exec(output);

    if (matches) {
        const [, depotPath, revision, localPath] = matches;
        const depotUri = PerforceUri.fromDepotPath(resource, matches[1], matches[2]);
        const localUri = vscode.Uri.file(localPath);
        return { depotPath, revision, depotUri, localUri };
    }
}

// TODO tidy this up

const haveFileCmd = makeSimpleCommand("have", haveFileFlags);

/**
 * Checks if we `have` a file.
 * @param resource Context for where to run the command
 * @param options Options for the command
 * @returns a perforce URI representing the depot path, revision etc
 */
export async function have(resource: vscode.Uri, options: HaveFileOptions) {
    const output = await haveFileCmd.ignoringStdErr(resource, options);
    return parseHaveOutput(resource, output);
}

// if stdout has any value, we have the file (stderr indicates we don't)
export const haveFile = asyncOuputHandler(haveFileCmd.ignoringAndHidingStdErr, isTruthy);

export type LoginOptions = {
    password: string;
};

export const login = makeSimpleCommand(
    "login",
    () => [],
    (options: LoginOptions) => {
        return {
            input: options.password
        };
    }
);

const getLoggedInStatus = makeSimpleCommand<NoOpts>("login", () => ["-s"]);

export async function isLoggedIn(resource: vscode.Uri): Promise<boolean> {
    try {
        await getLoggedInStatus(resource, {});
        return true;
    } catch {
        return false;
    }
}

export const logout = makeSimpleCommand<NoOpts>("logout", () => []);
