import { workspace, Uri, FileType } from "vscode";

import * as PerforceUri from "./PerforceUri";
import { Display } from "./Display";
import { PerforceSCMProvider } from "./ScmProvider";

import * as CP from "child_process";
import spawn from "cross-spawn";
import { CommandLimiter } from "./CommandLimiter";
import * as Path from "path";

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PerforceService {
    const limiter: CommandLimiter = new CommandLimiter(
        workspace.getConfiguration("perforce").get<number>("bottleneck.maxConcurrent") ??
            10
    );

    const debugModeActive: boolean =
        workspace.getConfiguration("perforce").get("debugModeActive") ?? false;

    let debugModeSetup = false;

    export function getOverrideDir(workspaceUri?: Uri) {
        const dir = workspace
            .getConfiguration("perforce", workspaceUri)
            .get<string>("dir");
        return dir === "none" ? undefined : dir;
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
        const config = workspace.getConfiguration("perforce", resource);
        const p4User = config.get("user", "none");
        const p4Client = config.get("client", "none");
        const p4Port = config.get("port", "none");
        const p4Pass = config.get("password", "none");
        const p4Dir = config.get("dir", "none");

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

        return ret;
    }

    let id = 0;

    export function execute(
        resource: Uri,
        command: string,
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void,
        args?: string[],
        input?: string
    ): void {
        if (debugModeActive && !debugModeSetup) {
            limiter.debugMode = true;
            debugModeSetup = true;
        }
        limiter.submit((onDone) => {
            execCommand(
                resource,
                command,
                (...rest) => {
                    // call done first in case responseCallback throws - the important part is done
                    onDone();
                    responseCallback(...rest);
                },
                args,
                input
            );
        }, `<JOB_ID:${++id}:${command}>`);
    }

    export function executeAsPromise(
        resource: Uri,
        command: string,
        args?: string[],
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
                input
            );
        });
    }

    async function isDirectory(uri: Uri): Promise<boolean> {
        try {
            return (await workspace.fs.stat(uri)).type === FileType.Directory;
        } catch {}
        return false;
    }

    async function execCommand(
        resource: Uri,
        command: string,
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void,
        args?: string[],
        input?: string
    ) {
        const actualResource = PerforceUri.getUsableWorkspace(resource) ?? resource;
        const cmd = getPerforceCmdPath();

        const allArgs: string[] = getPerforceCmdParams(actualResource);
        allArgs.push(command);

        if (args) {
            allArgs.push(...args);
        }

        const isDir = await isDirectory(actualResource);

        const cwd = isDir ? actualResource.fsPath : Path.dirname(actualResource.fsPath);

        const env = { ...process.env, PWD: cwd };
        const spawnArgs: CP.SpawnOptions = { cwd, env };
        spawnPerforceCommand(cmd, allArgs, spawnArgs, responseCallback, input);
    }

    function spawnPerforceCommand(
        cmd: string,
        allArgs: string[],
        spawnArgs: CP.SpawnOptions,
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void,
        input?: string
    ) {
        logExecutedCommand(cmd, allArgs, input, spawnArgs);
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

    function logExecutedCommand(
        cmd: string,
        args: string[],
        input: string | undefined,
        spawnArgs: CP.SpawnOptions
    ) {
        // not necessarily using these escaped values, because cross-spawn does its own escaping,
        // but no sensible way of logging the unescaped array for a user. The output command line
        // should at least be copy-pastable and work
        const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`);
        const loggedCommand = [cmd].concat(escapedArgs);
        const censoredInput = args[0].includes("login") ? "***" : input;
        const loggedInput = input ? " < " + censoredInput : "";
        Display.channel.appendLine(
            spawnArgs.cwd + ": " + loggedCommand.join(" ") + loggedInput
        );
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
                .then((stdout) => {
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
                .catch((err) => {
                    reject(err);
                });
        });
    }

    export function getConfigFilename(resource: Uri): Promise<string | undefined> {
        return new Promise((resolve, reject) => {
            PerforceService.executeAsPromise(resource, "set", ["-q"])
                .then((stdout) => {
                    let configIndex = stdout.indexOf("P4CONFIG=");
                    if (configIndex === -1) {
                        resolve(undefined);
                        return;
                    }

                    configIndex += "P4CONFIG=".length;
                    const endConfigIndex = stdout.indexOf("\n", configIndex);
                    if (endConfigIndex === -1) {
                        //reject("P4 set -q parsing for P4CONFIG contains unexpected format");
                        resolve(undefined);
                        return;
                    }

                    //Resolve with p4 config filename as string
                    resolve(stdout.substring(configIndex, endConfigIndex).trimRight());
                })
                .catch((err) => {
                    reject(err);
                });
        });
    }
}
