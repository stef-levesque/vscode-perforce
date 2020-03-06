"use strict";

import { PerforceCommands } from "./PerforceCommands";
import { PerforceContentProvider } from "./ContentProvider";
import FileSystemActions from "./FileSystemActions";
import { PerforceSCMProvider } from "./ScmProvider";
import { IPerforceConfig, PerforceService } from "./PerforceService";
import { Display } from "./Display";
import { Utils } from "./Utils";
import * as vscode from "vscode";
import * as Path from "path";

// for ini files
import * as fs from "fs";
import * as Ini from "ini";
import { Disposable } from "vscode";
import { WorkspaceConfigAccessor } from "./ConfigService";

let _isRegistered = false;
const _disposable: vscode.Disposable[] = [];

function TryCreateP4(uri: vscode.Uri): Promise<boolean> {
    Display.channel.appendLine("\n----------------------------");
    Display.channel.appendLine(uri + ": Trying to initialise");
    return new Promise<boolean>(resolve => {
        if (!uri.fsPath) {
            return resolve(false);
        }

        const wksFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (PerforceService.getConfig(wksFolder ? wksFolder.uri.fsPath : "")) {
            Display.channel.appendLine(
                uri + ": The workspace folder has already been initialised"
            );
            return resolve(false);
        }

        const CreateP4 = (config: IPerforceConfig): boolean => {
            // path fixups:
            const trailingSlash = /^(.*)(\/)$/;

            if (config.localDir) {
                config.localDir = Utils.normalize(config.localDir);
                if (!trailingSlash.exec(config.localDir)) {
                    config.localDir += "/";
                }
            }

            if (config.p4Dir) {
                config.p4Dir = Utils.normalize(config.p4Dir);
                if (!trailingSlash.exec(config.p4Dir)) {
                    config.p4Dir += "/";
                }
            }

            Display.channel.appendLine(
                uri + ": Resolved configuration: \n" + JSON.stringify(config, null, 2)
            );

            const wksUri =
                wksFolder && wksFolder.uri ? wksFolder.uri : vscode.Uri.parse("");

            if (PerforceService.getConfig(wksUri.fsPath)) {
                Display.channel.appendLine(
                    uri + ": The workspace has already been initialised: " + wksUri
                );
                return false;
            }

            Display.channel.appendLine(uri + ": OK. Initialising: " + wksUri);

            PerforceService.addConfig(config, wksUri.fsPath);
            const workspaceConfig = new WorkspaceConfigAccessor(wksUri);
            const scm = new PerforceSCMProvider(config, wksUri, workspaceConfig);
            scm.Initialize();
            _disposable.push(scm);
            _disposable.push(new FileSystemActions());

            doOneTimeRegistration();

            return true;
        };

        const CreateP4FromConfig = (configFile: vscode.Uri): boolean => {
            Display.channel.appendLine(uri + ": Reading config from " + configFile);
            const configPath = Path.dirname(configFile.fsPath);
            // todo: read config
            const contents = fs.readFileSync(configFile.fsPath, "utf-8");
            const cfg = Ini.parse(contents);

            const config: IPerforceConfig = {
                localDir: configPath,
                stripLocalDir: cfg.P4DIR ? true : false,
                p4Dir: cfg.P4DIR ? Utils.normalize(cfg.P4DIR) : configPath,

                p4Client: cfg.P4CLIENT,
                p4Host: cfg.P4HOST,
                p4Pass: cfg.P4PASS,
                p4Port: cfg.P4PORT,
                p4Tickets: cfg.P4TICKETS,
                p4User: cfg.P4USER
            };

            return CreateP4(config);
        };

        Display.channel.appendLine(uri + ": Finding a client root");
        PerforceService.getClientRoot(uri)
            .then(cliRoot => {
                cliRoot = Utils.normalize(cliRoot);
                Display.channel.appendLine(uri + ": Found client root: " + cliRoot);

                const wksFolder = vscode.workspace.getWorkspaceFolder(uri);
                if (!wksFolder) {
                    Display.channel.appendLine(
                        uri +
                            ": The location being initialised is not in an open workspace"
                    );
                    return resolve(CreateP4({ localDir: "" }));
                } // see uses of directoryOverride per file

                // asRelativePath doesn't catch if cliRoot IS wksRoot, so using startsWith
                // const rel = Utils.normalize(workspace.asRelativePath(cliRoot));

                const wksRootN = Utils.normalize(wksFolder.uri.fsPath);
                if (wksRootN.startsWith(cliRoot)) {
                    Display.channel.appendLine(
                        uri +
                            ": The workspace " +
                            wksRootN +
                            " is under the client root " +
                            cliRoot
                    );
                    return resolve(CreateP4({ localDir: wksRootN }));
                }

                Display.channel.appendLine(uri + ": Trying perforce.dir setting");

                // is p4dir specified in general settings?
                const p4Dir = vscode.workspace
                    .getConfiguration("perforce", uri)
                    .get("dir", "none");
                if (p4Dir !== "none") {
                    return resolve(CreateP4({ localDir: wksRootN }));
                }

                Display.channel.appendLine(
                    uri +
                        ": The workspace " +
                        wksRootN +
                        " is not within the p4 client root"
                );

                throw new Error("workspace is not within p4 clientRoot");
            })
            .catch(() => {
                const CheckAlways = (): boolean => {
                    // if autodetect fails, enable if settings dictate
                    Display.channel.appendLine(
                        uri + ": Checking perforce.activationMode"
                    );
                    if (
                        vscode.workspace
                            .getConfiguration("perforce")
                            .get("activationMode") === "always"
                    ) {
                        Display.channel.appendLine(
                            uri +
                                ": Activation mode is set to 'always'. Activating anyway"
                        );
                        const wksFolder = vscode.workspace.getWorkspaceFolder(uri);
                        const localDir = wksFolder ? wksFolder.uri.fsPath : "";
                        const config: IPerforceConfig = { localDir };
                        return CreateP4(config);
                    }

                    Display.channel.appendLine(
                        uri +
                            ": Not initialising.\n\nConsider setting/checking perforce.port, perforce.user, perforce.client in the extension settings"
                    );

                    return false;
                };

                // workspace is not within client root.
                // look for config files to specify p4Dir association
                PerforceService.getConfigFilename(uri)
                    .then(p4ConfigFileName => {
                        Display.channel.appendLine(
                            uri +
                                ": Looking for P4CONFIG files named: " +
                                p4ConfigFileName
                        );
                        const pattern = new vscode.RelativePattern(
                            wksFolder ? wksFolder : "",
                            `**/${p4ConfigFileName}`
                        );
                        vscode.workspace
                            .findFiles(pattern, "**/node_modules/**")
                            .then((files: vscode.Uri[]) => {
                                if (!files || files.length === 0) {
                                    Display.channel.appendLine(uri + ": No files found");
                                    return resolve(CheckAlways());
                                }

                                let anyCreated = false;
                                for (const file of files) {
                                    const created = CreateP4FromConfig(file);
                                    anyCreated = anyCreated || created;
                                }
                                return resolve(anyCreated);
                            });
                    })
                    .catch(err => {
                        Display.channel.appendLine(
                            uri + ": Error trying to find / read config " + err
                        );
                        return resolve(CheckAlways());
                    });
            });
    });
}

export function activate(ctx: vscode.ExtensionContext): void {
    if (vscode.workspace.getConfiguration("perforce").get("activationMode") === "off") {
        return;
    }

    Display.initializeChannel(_disposable);

    ctx.subscriptions.push(
        new vscode.Disposable(() => Disposable.from(..._disposable).dispose())
    );

    vscode.workspace.onDidChangeWorkspaceFolders(
        onDidChangeWorkspaceFolders,
        null,
        ctx.subscriptions
    );
    onDidChangeWorkspaceFolders({
        added: vscode.workspace.workspaceFolders || [],
        removed: []
    });

    vscode.workspace.onDidChangeConfiguration(
        onDidChangeConfiguration,
        null,
        ctx.subscriptions
    );
}

function doOneTimeRegistration() {
    if (!_isRegistered) {
        _isRegistered = true;

        Display.channel.appendLine(
            "Performing one-time registration of perforce commands"
        );

        Display.initialize(_disposable);

        _disposable.push(new PerforceContentProvider());

        // todo: fix dependency / order of operations issues
        PerforceCommands.registerCommands();
        PerforceSCMProvider.registerCommands();
    }
}

const settingsRequiringRestart = [
    "perforce.activationMode",
    "perforce.editOnFileSave",
    "perforce.editOnFileModified",
    "perforce.addOnFileCreate",
    "perforce.deleteOnFileDelete",
    "perforce.client",
    "perforce.port",
    "perforce.user",
    "perforce.password",
    "perforce.dir",
    "perforce.command",
    "perforce.bottleneck.maxConcurrent"
];

let didShowConfigWarning = false;

async function onDidChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
    if (didShowConfigWarning) {
        return;
    }

    for (const setting of settingsRequiringRestart) {
        if (event.affectsConfiguration(setting)) {
            didShowConfigWarning = true;
            const restart = "Restart Now";
            const answer = await vscode.window.showWarningMessage(
                "You have changed a perforce setting that may require a restart to take effect. When you are done, please restart VS Code",
                restart
            );
            if (answer === restart) {
                vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
            return;
        }
    }
}

async function onDidChangeWorkspaceFolders({
    added
}: vscode.WorkspaceFoldersChangeEvent): Promise<void> {
    Display.channel.appendLine(
        "==============================\nWorkspace folders changed. Starting initialisation.\n"
    );

    try {
        if (added !== undefined) {
            Display.channel.appendLine("Workspaces were added");
            for (const workspace of added) {
                await TryCreateP4(workspace.uri);
            }
        } else {
            Display.channel.appendLine("No workspaces. Trying all open documents");
            const promises = vscode.workspace.textDocuments.map(doc =>
                TryCreateP4(doc.uri)
            );
            await Promise.all(promises);
        }
    } catch (err) {
        Display.channel.appendLine("Error: " + err);
    }

    Display.channel.appendLine(
        "\nInitialisation finished\n==============================\n"
    );
}
