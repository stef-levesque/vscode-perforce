'use strict';

import { PerforceCommands } from './PerforceCommands';
import { PerforceContentProvider } from './ContentProvider';
import FileSystemListener from './FileSystemListener';
import { PerforceSCMProvider } from './ScmProvider';
import { IPerforceConfig, PerforceService } from './PerforceService';
import { Display } from './Display';
import { Utils } from './Utils';
import * as vscode from 'vscode';
import * as Path from 'path';

// for ini files
import * as fs from 'fs';
import * as Ini from 'ini';

let _isRegistered: boolean = false;

function TryCreateP4(uri: vscode.Uri, ctx: vscode.ExtensionContext): void {
    if (!uri.fsPath) return;

    const CreateP4 = (config: IPerforceConfig): void => {
        const compatibilityMode = vscode.workspace.getConfiguration('perforce').get('compatibilityMode', 'perforce');
        vscode.commands.executeCommand('setContext', 'perforce.compatibilityMode', compatibilityMode);

        // path fixups:
        const trailingSlash = /^(.*)(\/)$/;

        if (config.localDir) {
            config.localDir = Utils.normalize(config.localDir);
            if (!trailingSlash.exec(config.localDir)) config.localDir += '/';
        }

        if (config.p4Dir) {
            config.p4Dir = Utils.normalize(config.p4Dir);
            if (!trailingSlash.exec(config.p4Dir)) config.p4Dir += '/';
        }

        const wksFolder = vscode.workspace.getWorkspaceFolder(uri);
        PerforceService.setConfig(config, wksFolder ? wksFolder.uri.fsPath : ''); //TODO: valid default case ?
        ctx.subscriptions.push(new PerforceSCMProvider(config, compatibilityMode));

        // Register only once
        if (!_isRegistered) {
            _isRegistered = true;

            ctx.subscriptions.push(new PerforceContentProvider(compatibilityMode));
            ctx.subscriptions.push(new FileSystemListener());

            // todo: fix dependency / order of operations issues
            PerforceCommands.registerCommands();
            PerforceSCMProvider.registerCommands();
            Display.initialize();
        }
    }

    const CreateP4FromConfig = (configFile: vscode.Uri): void => {
        const configPath = Path.dirname(configFile.fsPath);
        // todo: read config
        const contents = fs.readFileSync(configFile.fsPath, 'utf-8');
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
            p4User: cfg.P4USER,
        };

        CreateP4(config);
    }

    PerforceService.getClientRoot(uri)
        .then((cliRoot) => {
            cliRoot = Utils.normalize(cliRoot);

            const wksFolder = vscode.workspace.getWorkspaceFolder(uri);
            if (!wksFolder) return CreateP4({ localDir: '' }); // see uses of directoryOverride per file

            // asRelativePath doesn't catch if cliRoot IS wksRoot, so using startsWith
            // const rel = Utils.normalize(workspace.asRelativePath(cliRoot));

            // todo: per workspace folder for new interface
            const wksRootN = Utils.normalize(wksFolder.uri.fsPath);
            if (wksRootN.startsWith(cliRoot)) return CreateP4({ localDir: wksRootN });

            // is p4dir specified in general settings?
            const p4Dir = vscode.workspace.getConfiguration('perforce', uri).get('dir', 'none');
            if (p4Dir !== 'none') {
                return CreateP4({ localDir: wksRootN });
            }

            throw 'workspace is not within p4 clientRoot';
        })
        .catch((err) => {

            const CheckAlways = () => {
                // if autodetect fails, enable if settings dictate
                if (vscode.workspace.getConfiguration('perforce').get('activationMode') === 'always') {
                    const wksFolder = vscode.workspace.getWorkspaceFolder(uri);
                    let localDir = wksFolder ? wksFolder.uri.fsPath : '';
                    const config: IPerforceConfig = { localDir };
                    CreateP4(config);
                }
            }

            // workspace is not within client root.
            // look for config files to specify p4Dir association
            PerforceService.getConfigFilename(uri)
                .then((p4ConfigFileName) => {
                    vscode.workspace.findFiles(`**/${p4ConfigFileName}`, '**/node_modules/**')
                        .then((files: vscode.Uri[]) => {

                            if (!files || files.length === 0) {
                                return CheckAlways();
                            }

                            files.forEach((file) => {
                                CreateP4FromConfig(file);
                            });
                        });
                })
                .catch((err) => {
                    return CheckAlways();
                });
        });
}

export function activate(ctx: vscode.ExtensionContext): void {

    // todo: enableProposedApi; workspace.workspaceFolders[]

    //workspace.onDidOpenTextDocument

    // const editor = vscode.window.activeTextEditor;
    // var filePath = Path.dirname(editor.document.uri.fsPath);

    if (vscode.workspace.getConfiguration('perforce').get('activationMode') === 'off') {
        return;
    }

    if (vscode.workspace.workspaceFolders !== undefined) {
        vscode.workspace.workspaceFolders.forEach((workspace) => {
            TryCreateP4(workspace.uri, ctx);
        });
    } else {
        vscode.workspace.textDocuments.forEach((doc) => {
            TryCreateP4(doc.uri, ctx);
        });
    }
}