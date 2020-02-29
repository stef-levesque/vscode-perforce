import { workspace, Uri } from "vscode";

import { Utils } from "./Utils";
import { Display } from "./Display";
import { PerforceSCMProvider } from "./ScmProvider";

import * as CP from "child_process";
import * as spawn from "cross-spawn";
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
        workspace.getConfiguration("perforce").get<number>("bottleneck.maxConcurrent") ??
            10
    );

    const debugModeActive: boolean =
        workspace.getConfiguration("perforce").get("debugModeActive") ?? false;

    let debugModeSetup = false;

    const _configs: { [key: string]: IPerforceConfig } = {};

    export function addConfig(inConfig: IPerforceConfig, workspacePath: string): void {
        _configs[workspacePath] = inConfig;
    }
    export function removeConfig(workspacePath: string): void {
        delete _configs[workspacePath];
    }
    export function getConfig(workspacePath: string): IPerforceConfig {
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

    function getPerforceCmdPath(): string {
        let p4Path = workspace.getConfiguration("perforce").get("command", "none");

        if (p4Path === "none") {
            const isWindows = process.platform.startsWith("win");
            p4Path = isWindows ? "p4.exe" : "p4";
        } else {
            const toUNC = (path: string): string => {
                let uncPath = path;

                if (!uncPath.startsWith("\\\\")) {
                    const replaceable = uncPath.split("\\");
                    uncPath = replaceable.join("\\\\");
                }

                return uncPath;
            };

            p4Path = toUNC(p4Path);
        }
        return p4Path;
    }

    function getPerforceCmdParams(resource: Uri): string[] {
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

        const ret: string[] = [];

        const buildCmd = (value: string | number | undefined, arg: string): string[] => {
            if (!value || value === "none") {
                return [];
            }
            return [arg, value.toString()];
        };

        ret.push(...buildCmd(p4User, "-u"));
        ret.push(...buildCmd(p4Client, "-c"));
        ret.push(...buildCmd(p4Port, "-p"));
        ret.push(...buildCmd(p4Pass, "-P"));
        ret.push(...buildCmd(p4Dir, "-d"));

        // later args override earlier args
        const wksFolder = workspace.getWorkspaceFolder(resource);
        const config = wksFolder ? getConfig(wksFolder.uri.fsPath) : null;
        if (config) {
            ret.push(...buildCmd(config.p4User, "-u"));
            ret.push(...buildCmd(config.p4Client, "-c"));
            ret.push(...buildCmd(config.p4Port, "-p"));
            ret.push(...buildCmd(config.p4Pass, "-P"));
            ret.push(...buildCmd(config.p4Dir, "-d"));
        }

        return ret;
    }

    let id = 0;

    export function execute(
        resource: Uri,
        command: string,
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void,
        args?: string[],
        directoryOverride?: string | null,
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
        args?: string[],
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
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void,
        args?: string[],
        directoryOverride?: string | null,
        input?: string
    ): void {
        const wksFolder = workspace.getWorkspaceFolder(resource);
        const config = wksFolder ? getConfig(wksFolder.uri.fsPath) : null;
        const wksPath = wksFolder ? wksFolder.uri.fsPath : "";
        const cmd = getPerforceCmdPath();

        const allArgs: string[] = getPerforceCmdParams(resource);
        if (directoryOverride !== null && directoryOverride !== undefined) {
            allArgs.push("-d", directoryOverride);
        }
        allArgs.push(command);

        if (args !== undefined) {
            if (config && config.stripLocalDir) {
                args = args.map(arg => arg.replace(config.localDir, ""));
            }

            allArgs.push(...args);
        }

        const spawnArgs: CP.SpawnOptions = { cwd: config ? config.localDir : wksPath };
        spawnPerforceCommand(cmd, allArgs, spawnArgs, responseCallback, input);
    }

    function spawnPerforceCommand(
        cmd: string,
        allArgs: string[],
        spawnArgs: CP.SpawnOptions,
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void,
        input?: string
    ) {
        logExecutedCommand(cmd, allArgs);
        const child = spawn(cmd, allArgs, spawnArgs);

        let called = false;
        child.on("error", (err: Error) => {
            if (!called) {
                called = true;
                responseCallback(err, "", "");
            }
        });

        if (input !== undefined) {
            if (!child.stdin) {
                throw new Error("Child does not have standard input");
            }
            child.stdin.end(input, "utf8");
        }

        getResults(child).then((value: string[]) => {
            if (!called) {
                responseCallback(null, value[0] ?? "", value[1] ?? "");
            }
        });
    }

    function logExecutedCommand(cmd: string, args: string[]) {
        // not necessarily using these escaped values, because cross-spawn does its own escaping,
        // but no sensible way of logging the unescaped array for a user. The output command line
        // should at least be copy-pastable and work
        const escapedArgs = args.map(arg => `'${arg.replace(/'/g, `'\\''`)}'`);
        const loggedCommand = [cmd].concat(escapedArgs);
        Display.channel.appendLine(loggedCommand.join(" "));
    }

    async function getResults(child: CP.ChildProcess): Promise<string[]> {
        return Promise.all([readStdOut(child), readStdErr(child)]);
    }

    async function readStdOut(child: CP.ChildProcess) {
        let output: string = "";
        if (child.stdout) {
            for await (const data of child.stdout) {
                output += data.toString();
            }
        }
        return output;
    }

    async function readStdErr(child: CP.ChildProcess) {
        let output: string = "";
        if (child.stderr) {
            for await (const data of child.stderr) {
                output += data.toString();
            }
        }
        return output;
    }

    export function handleCommonServiceResponse(
        err: Error | null,
        stdout: string,
        stderr: string
    ) {
        if (err || stderr) {
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
                    resolve(
                        stdout.substring(clientRootIndex, endClientRootIndex).trimRight()
                    );
                })
                .catch(err => {
                    reject(err);
                });
        });
    }

    export function getConfigFilename(resource: Uri): Promise<string> {
        return new Promise((resolve, reject) => {
            PerforceService.executeAsPromise(resource, "set", ["-q"])
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
                    resolve(stdout.substring(configIndex, endConfigIndex).trimRight());
                })
                .catch(err => {
                    reject(err);
                });
        });
    }
}
