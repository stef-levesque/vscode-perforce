import { workspace, Uri } from "vscode";

import { Utils } from "./Utils";
import { Display } from "./Display";
import { PerforceSCMProvider } from "./ScmProvider";

import * as CP from "child_process";
import { CommandLimiter } from "./CommandLimiter";

// eslint-disable-next-line @typescript-eslint/interface-name-prefix
export interface IPerforceConfig {
    // p4 standard configuration variables
    p4Client?: string;
    p4Host?: string;
    p4Pass?: string;
    p4Port?: number;
    p4Tickets?: string;
    p4User?: string;

    // specific to this exension
    // use this value as the clientRoot PWD for this .p4config file's location
    p4Dir?: string;

    // root directory of the user space (or .p4config)
    localDir: string;

    // whether to strip the localDir when calling espansePath
    stripLocalDir?: boolean;
}

export function matchConfig(config: IPerforceConfig, uri: Uri): boolean {
    // path fixups:
    const trailingSlash = /^(.*)(\/)$/;
    let compareDir = Utils.normalize(uri.fsPath);
    if (!trailingSlash.exec(compareDir)) {
        compareDir += "/";
    }

    if (config.localDir === compareDir) {
        return true;
    }

    return false;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PerforceService {
    const limiter: CommandLimiter = new CommandLimiter(
        workspace.getConfiguration("perforce").get<number>("bottleneck.maxConcurrent")
    );

    const debugModeActive: boolean = workspace
        .getConfiguration("perforce")
        .get("debugModeActive");

    let debugModeSetup = false;

    const _configs: { [key: string]: IPerforceConfig } = {};

    export function addConfig(inConfig: IPerforceConfig, workspacePath: string): void {
        _configs[workspacePath] = inConfig;
    }
    export function removeConfig(workspacePath: string): void {
        delete _configs[workspacePath];
    }
    export function getConfig(workspacePath): IPerforceConfig {
        return _configs[workspacePath];
    }
    export function convertToRel(path: string): string {
        const wksFolder = workspace.getWorkspaceFolder(Uri.file(path));
        const config = wksFolder ? _configs[wksFolder.uri.fsPath] : null;
        if (
            !config ||
            !config.stripLocalDir ||
            !config.localDir ||
            config.localDir.length === 0 ||
            !config.p4Dir ||
            config.p4Dir.length === 0
        ) {
            return path;
        }

        const pathN = Utils.normalize(path);
        if (pathN.startsWith(config.localDir)) {
            path = pathN.slice(config.localDir.length);
        }
        return path;
    }

    export function getPerforceCmdPath(resource: Uri): string {
        let p4Path = workspace.getConfiguration("perforce").get("command", "none");
        const p4User = workspace
            .getConfiguration("perforce", resource)
            .get("user", "none");
        const p4Client = workspace
            .getConfiguration("perforce", resource)
            .get("client", "none");
        const p4Port = workspace
            .getConfiguration("perforce", resource)
            .get("port", "none");
        const p4Pass = workspace
            .getConfiguration("perforce", resource)
            .get("password", "none");
        const p4Dir = workspace.getConfiguration("perforce", resource).get("dir", "none");

        const buildCmd = (value, arg): string => {
            if (!value || value === "none") {
                return "";
            }
            return ` ${arg} ${value}`;
        };

        if (p4Path == "none") {
            const isWindows = process.platform.startsWith("win");
            p4Path = isWindows ? "p4.exe" : "p4";
        } else {
            const toUNC = (path: string): string => {
                let uncPath = path;

                if (!uncPath.startsWith("\\\\")) {
                    const replaceable = uncPath.split("\\");
                    uncPath = replaceable.join("\\\\");
                }

                uncPath = `"${uncPath}"`;
                return uncPath;
            };

            p4Path = toUNC(p4Path);
        }

        p4Path += buildCmd(p4User, "-u");
        p4Path += buildCmd(p4Client, "-c");
        p4Path += buildCmd(p4Port, "-p");
        p4Path += buildCmd(p4Pass, "-P");
        p4Path += buildCmd(p4Dir, "-d");

        // later args override earlier args
        const wksFolder = workspace.getWorkspaceFolder(resource);
        const config = wksFolder ? getConfig(wksFolder.uri.fsPath) : null;
        if (config) {
            p4Path += buildCmd(config.p4User, "-u");
            p4Path += buildCmd(config.p4Client, "-c");
            p4Path += buildCmd(config.p4Port, "-p");
            p4Path += buildCmd(config.p4Pass, "-P");
            p4Path += buildCmd(config.p4Dir, "-d");
        }

        return p4Path;
    }

    let id = 0;

    export function execute(
        resource: Uri,
        command: string,
        responseCallback: (err: Error, stdout: string, stderr: string) => void,
        args?: string,
        directoryOverride?: string,
        input?: string
    ): void {
        if (debugModeActive && !debugModeSetup) {
            limiter.debugMode = true;
            debugModeSetup = true;
        }
        //execCommand(resource, command, responseCallback, args, directoryOverride, input);
        limiter.submit(onDone => {
            execCommand(
                resource,
                command,
                (...rest) => {
                    // call done first in case responseCallback throws - the important part is done
                    onDone();
                    responseCallback(...rest);
                },
                args,
                directoryOverride,
                input
            );
        }, `<JOB_ID:${++id}:${command}>`);
    }

    export function executeAsPromise(
        resource: Uri,
        command: string,
        args?: string,
        directoryOverride?: string,
        input?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            execute(
                resource,
                command,
                (err, stdout, stderr) => {
                    if (err) {
                        reject(err.message);
                    } else if (stderr) {
                        reject(stderr);
                    } else {
                        resolve(stdout.toString());
                    }
                },
                args,
                directoryOverride,
                input
            );
        });
    }

    function execCommand(
        resource: Uri,
        command: string,
        responseCallback: (err: Error, stdout: string, stderr: string) => void,
        args?: string,
        directoryOverride?: string,
        input?: string
    ): void {
        const wksFolder = workspace.getWorkspaceFolder(resource);
        const config = wksFolder ? getConfig(wksFolder.uri.fsPath) : null;
        const wksPath = wksFolder ? wksFolder.uri.fsPath : "";
        let cmdLine = getPerforceCmdPath(resource);
        const maxBuffer = workspace
            .getConfiguration("perforce")
            .get("maxBuffer", 200 * 1024);

        if (directoryOverride != null) {
            cmdLine += " -d " + directoryOverride;
        }
        cmdLine += " " + command;

        if (args != null) {
            if (config && config.stripLocalDir) {
                args = args.replace(config.localDir, "");
            }

            cmdLine += " " + args;
        }

        Display.channel.appendLine(cmdLine);
        const cmdArgs = { cwd: config ? config.localDir : wksPath, maxBuffer: maxBuffer };
        const child = CP.exec(cmdLine, cmdArgs, responseCallback);

        if (input != null) {
            child.stdin.end(input, "utf8");
        }
    }

    export function handleInfoServiceResponse(
        err: Error,
        stdout: string,
        stderr: string
    ) {
        if (err) {
            Display.showError(stderr.toString());
        } else {
            Display.channel.append(stdout.toString());
        }
    }

    export function handleCommonServiceResponse(
        err: Error,
        stdout: string,
        stderr: string
    ) {
        if (err) {
            Display.showError(stderr.toString());
        } else {
            Display.channel.append(stdout.toString());
            Display.updateEditor();
            PerforceSCMProvider.RefreshAll();
        }
    }

    export function getClientRoot(resource: Uri): Promise<string> {
        return new Promise((resolve, reject) => {
            PerforceService.executeAsPromise(resource, "info")
                .then(stdout => {
                    let clientRootIndex = stdout.indexOf("Client root: ");
                    if (clientRootIndex === -1) {
                        reject("P4 Info didn't specify a valid Client Root path");
                        return;
                    }

                    clientRootIndex += "Client root: ".length;
                    const endClientRootIndex = stdout.indexOf("\n", clientRootIndex);
                    if (endClientRootIndex === -1) {
                        reject("P4 Info Client Root path contains unexpected format");
                        return;
                    }

                    //Resolve with client root as string
                    resolve(stdout.substring(clientRootIndex, endClientRootIndex));
                })
                .catch(err => {
                    reject(err);
                });
        });
    }

    export function getConfigFilename(resource: Uri): Promise<string> {
        return new Promise((resolve, reject) => {
            PerforceService.executeAsPromise(resource, "set", "-q")
                .then(stdout => {
                    let configIndex = stdout.indexOf("P4CONFIG=");
                    if (configIndex === -1) {
                        resolve(".p4config");
                        return;
                    }

                    configIndex += "P4CONFIG=".length;
                    const endConfigIndex = stdout.indexOf("\n", configIndex);
                    if (endConfigIndex === -1) {
                        //reject("P4 set -q parsing for P4CONFIG contains unexpected format");
                        resolve(".p4config");
                        return;
                    }

                    //Resolve with p4 config filename as string
                    resolve(stdout.substring(configIndex, endConfigIndex));
                })
                .catch(err => {
                    reject(err);
                });
        });
    }
}
