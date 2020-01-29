"use strict";

import { PerforceCommands } from "./PerforceCommands";
import { PerforceContentProvider } from "./ContentProvider";
import FileSystemListener from "./FileSystemListener";
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
    return new Promise<boolean>(resolve => {
        if (!uri.fsPath) {
            return resolve(false);
        }

        const wksFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (PerforceService.getConfig(wksFolder ? wksFolder.uri.fsPath : "")) {
            return resolve(false);
        }

        const CreateP4 = (config: IPerforceConfig): boolean => {
            const compatibilityMode = vscode.workspace
                .getConfiguration("perforce")
                .get("compatibilityMode", "perforce");
            vscode.commands.executeCommand(
                "setContext",
                "perforce.compatibilityMode",
                compatibilityMode
            );

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

            const wksUri =
                wksFolder && wksFolder.uri ? wksFolder.uri : vscode.Uri.parse("");

            if (PerforceService.getConfig(wksUri.fsPath)) {
                return false;
            }

            PerforceService.addConfig(config, wksUri.fsPath);
            const workspaceConfig = new WorkspaceConfigAccessor(wksUri);
            const scm = new PerforceSCMProvider(
                config,
                wksUri,
                workspaceConfig,
                compatibilityMode
            );
            scm.Initialize();
            _disposable.push(scm);
            _disposable.push(new FileSystemListener(wksFolder));

            // Register only once
            if (!_isRegistered) {
                _isRegistered = true;

                _disposable.push(new PerforceContentProvider(compatibilityMode));

                // todo: fix dependency / order of operations issues
                PerforceCommands.registerCommands();
                PerforceSCMProvider.registerCommands();
                Display.initialize();
            }

            return true;
        };

        const CreateP4FromConfig = (configFile: vscode.Uri): boolean => {
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

        PerforceService.getClientRoot(uri)
            .then(cliRoot => {
                cliRoot = Utils.normalize(cliRoot);

                const wksFolder = vscode.workspace.getWorkspaceFolder(uri);
                if (!wksFolder) {
                    return resolve(CreateP4({ localDir: "" }));
                } // see uses of directoryOverride per file

                // asRelativePath doesn't catch if cliRoot IS wksRoot, so using startsWith
                // const rel = Utils.normalize(workspace.asRelativePath(cliRoot));

                const wksRootN = Utils.normalize(wksFolder.uri.fsPath);
                if (wksRootN.startsWith(cliRoot)) {
                    return resolve(CreateP4({ localDir: wksRootN }));
                }

                // is p4dir specified in general settings?
                const p4Dir = vscode.workspace
                    .getConfiguration("perforce", uri)
                    .get("dir", "none");
                if (p4Dir !== "none") {
                    return resolve(CreateP4({ localDir: wksRootN }));
                }

                throw "workspace is not within p4 clientRoot";
            })
            .catch(() => {
                const CheckAlways = (): boolean => {
                    // if autodetect fails, enable if settings dictate
                    if (
                        vscode.workspace
                            .getConfiguration("perforce")
                            .get("activationMode") === "always"
                    ) {
                        const wksFolder = vscode.workspace.getWorkspaceFolder(uri);
                        const localDir = wksFolder ? wksFolder.uri.fsPath : "";
                        const config: IPerforceConfig = { localDir };
                        return CreateP4(config);
                    }

                    return false;
                };

                // workspace is not within client root.
                // look for config files to specify p4Dir association
                PerforceService.getConfigFilename(uri)
                    .then(p4ConfigFileName => {
                        const pattern = new vscode.RelativePattern(
                            wksFolder ? wksFolder : "",
                            `**/${p4ConfigFileName}`
                        );
                        vscode.workspace
                            .findFiles(pattern, "**/node_modules/**")
                            .then((files: vscode.Uri[]) => {
                                if (!files || files.length === 0) {
                                    return CheckAlways();
                                }

                                let anyCreated = false;
                                for (const file of files) {
                                    const created = CreateP4FromConfig(file);
                                    anyCreated = anyCreated || created;
                                }
                                return resolve(anyCreated);
                            });
                    })
                    .catch(() => {
                        return resolve(CheckAlways());
                    });
            });
    });
}

export function activate(ctx: vscode.ExtensionContext): void {
    if (vscode.workspace.getConfiguration("perforce").get("activationMode") === "off") {
        return;
    }
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
}

async function onDidChangeWorkspaceFolders({
    added
}: vscode.WorkspaceFoldersChangeEvent): Promise<void> {
    if (added !== undefined) {
        for (const workspace of added) {
            await TryCreateP4(workspace.uri);
        }
    } else {
        for (const doc of vscode.workspace.textDocuments) {
            TryCreateP4(doc.uri);
        }
    }
}
