"use strict";

import { PerforceCommands } from "./PerforceCommands";
import { PerforceContentProvider } from "./ContentProvider";
import FileSystemActions from "./FileSystemActions";
import { PerforceSCMProvider } from "./ScmProvider";
import { PerforceService } from "./PerforceService";
import { Display } from "./Display";
import { Utils } from "./Utils";
import * as vscode from "vscode";
import * as Path from "path";

import { Disposable } from "vscode";
import { WorkspaceConfigAccessor } from "./ConfigService";
import { AnnotationProvider } from "./annotations/AnnotationProvider";
import * as ContextVars from "./ContextVars";
import * as QuickPicks from "./quickPick/QuickPicks";
import * as p4 from "./api/PerforceApi";
import { isTruthy } from "./TsUtils";

let _isRegistered = false;
const _disposable: vscode.Disposable[] = [];
let _perforceContentProvider: PerforceContentProvider | undefined;
const _dirsWithNoClient = new Set<string>();

function logInitProgress(uri: vscode.Uri, message: string) {
    Display.channel.appendLine("> " + uri + ": " + message);
}

export type ClientRoot = {
    configSource: vscode.Uri;
    clientRoot: vscode.Uri;
    clientName: string;
    userName: string;
    serverAddress: string;
    isInRoot: boolean;
    isAboveRoot?: boolean;
};

async function findClientRoot(uri: vscode.Uri): Promise<ClientRoot | undefined> {
    try {
        const info = await p4.getInfo(uri, {});
        const rootStr = info.get("Client root");
        if (rootStr) {
            const clientName = info.get("Client name") ?? "unknown";
            const serverAddress = info.get("Server address") ?? "";
            const userName = info.get("User name") ?? "";
            const isInRoot = isInClientRoot(uri, Utils.normalize(rootStr));
            const isAboveRoot = isClientRootIn(uri, Utils.normalize(rootStr));
            return {
                configSource: uri,
                clientRoot: vscode.Uri.file(rootStr),
                clientName,
                userName,
                serverAddress,
                isInRoot,
                isAboveRoot,
            };
        }
    } catch (err) {}
    return undefined;
}

function setActivationContext(key: string, reason: string | boolean) {
    vscode.commands.executeCommand("setContext", "perforce.activation." + key, reason);
}

function isInClientRoot(testFile: vscode.Uri, rootFsPath: string) {
    const wksRootN = Utils.normalize(testFile.fsPath);
    return wksRootN.startsWith(rootFsPath);
}

function isClientRootIn(workspace: vscode.Uri, rootFsPath: string) {
    const wksRootN = Utils.normalize(workspace.fsPath);
    return rootFsPath.startsWith(wksRootN);
}

async function findP4ConfigFiles(
    wksFolder: vscode.WorkspaceFolder
): Promise<vscode.Uri[]> {
    const workspaceUri = wksFolder.uri;

    const configName = await PerforceService.getConfigFilename(workspaceUri);
    const noConfig = !configName;

    const pattern = new vscode.RelativePattern(
        wksFolder,
        noConfig ? `**/.p4config` : `**/${configName}`
    );

    if (noConfig) {
        setActivationContext("noP4Config", true);
        logInitProgress(
            workspaceUri,
            "Did NOT find a valid P4CONFIG setting.\n" +
                "!!! IMPORTANT !!!\nPreviously, if no P4CONFIG setting was found, the extension would look for files name .p4config and parse them.\n" +
                "This is no longer the case. If you use p4config files, Please set your P4CONFIG setting and restart,\n" +
                "Either via environment variables or p4 set, e.g.:\n" +
                "\t\tp4 set P4CONFIG=.p4config\n!!! IMPORTANT !!!\n"
        );
    } else {
        logInitProgress(workspaceUri, "Using pattern " + pattern.pattern);
    }

    const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**");
    if (files.length > 0 && noConfig) {
        logInitProgress(
            workspaceUri,
            "Found " + files.length + " .p4config files that are VERY UNLIKELY to work"
        );
        // DON'T AWAIT, will hold up activation
        warnAboutP4Config(files.length);
    }

    return files;
}

async function warnAboutP4Config(numFiles: number) {
    if (
        !vscode.workspace
            .getConfiguration("perforce")
            .get<boolean>("warnOnMissingP4CONFIG")
    ) {
        return;
    }

    const ignore = "Don't show again in this workspace";
    const moreDetails = "More Details...";
    const result = await vscode.window.showWarningMessage(
        "Perforce WARNING: Your workspace contains " +
            numFiles +
            " .p4config file(s), but your P4CONFIG setting is undefined. Please set P4CONFIG in your environment and restart VS Code to detect these perforce clients",
        ignore,
        moreDetails
    );

    if (result === ignore) {
        await vscode.workspace
            .getConfiguration("perforce")
            .update("warnOnMissingP4CONFIG", false);
    } else if (result === moreDetails) {
        await vscode.env.openExternal(
            vscode.Uri.parse(
                "https://github.com/mjcrouch/vscode-perforce/blob/master/MIGRATION.md"
            )
        );
    }
}

function clientRootLog(
    source: string,
    foundRoot: ClientRoot | undefined,
    hasWorkingDirOverride?: boolean,
    shouldAlwaysActivate?: boolean
) {
    if (!foundRoot) {
        return "  * " + source + " : NO CLIENT ROOT FOUND";
    }
    const ignoreMsg = hasWorkingDirOverride
        ? "USING ANYWAY because working dir override is set"
        : shouldAlwaysActivate
        ? "USING ANYWAY because activation mode is set to ALWAYS"
        : "IGNORING THIS CLIENT";
    return (
        "  * " +
        source +
        " :\n\tClient name: " +
        foundRoot.clientName +
        "\n\tClient root: " +
        foundRoot.clientRoot.fsPath +
        "\n\tUser name: " +
        foundRoot.userName +
        "\n\tServer address: " +
        foundRoot.serverAddress +
        "\n" +
        (foundRoot.isInRoot || foundRoot.isAboveRoot
            ? "\tFolder IS in or above client root"
            : "!!\tFolder IS NOT in client root - " + ignoreMsg)
    );
}

function getActivationMode() {
    return (
        vscode.workspace.getConfiguration("perforce").get<string>("activationMode") ??
        "autodetect"
    );
}

function getOverrideInfo(workspaceUri: vscode.Uri) {
    const vsConfig = vscode.workspace.getConfiguration("perforce", workspaceUri);

    const overrides: [string, string | undefined][] = [
        ["perforce.port", vsConfig.get("port")],
        ["perforce.user", vsConfig.get("user")],
        ["perforce.client", vsConfig.get("client")],
        ["perforce.dir", vsConfig.get("dir")],
    ];

    return overrides
        .map((o) => {
            const prefix = "\t\t";
            const suffix =
                o[1] && o[1] !== "none" ? "\t(!OVERRIDE!)" : "\t(will not override)";
            return prefix + o[0] + ": " + o[1] + suffix;
        })
        .join("\n");
}

function initClientRoot(workspaceUri: vscode.Uri, client: ClientRoot): boolean {
    const existing = PerforceSCMProvider.GetInstanceByClient(client);
    if (existing) {
        logInitProgress(
            workspaceUri,
            "SCM provider already exists for " +
                client.clientName +
                " @ " +
                client.clientRoot.fsPath +
                " - not creating another for source : " +
                client.configSource.fsPath
        );

        existing.addContributingDir(client.configSource);

        return false;
    } else {
        logInitProgress(
            workspaceUri,
            "Creating SCM provider for " +
                client.clientName +
                " @ " +
                client.clientRoot.fsPath +
                " because of source : " +
                client.configSource.fsPath
        );

        const scm = initScmProvider(client);
        scm.addContributingDir(client.configSource);

        return true;
    }
}

function initScmProvider(client: ClientRoot): PerforceSCMProvider {
    const workspaceConfig = new WorkspaceConfigAccessor(client.configSource); // TODO doesn't make sense any more
    const scm = new PerforceSCMProvider(client, workspaceConfig);

    scm.Initialize();
    _disposable.push(scm);
    _disposable.push(new FileSystemActions(vscode.workspace, workspaceConfig));

    doOneTimeRegistration();
    Display.activateStatusBar();
    return scm;
}

function initClientRoots(workspaceUri: vscode.Uri, ...clientRoots: ClientRoot[]) {
    let created = 0;
    let ignored = 0;
    clientRoots.forEach((client) => {
        initClientRoot(workspaceUri, client) ? ++created : ++ignored;
    });

    logInitProgress(
        workspaceUri,
        `Initialisation done for this workspace. Created ${created} provider(s), ignored ${ignored} duplicate(s)\n\n`
    );
}

async function findClientRootsForP4Configs(wksFolder: vscode.WorkspaceFolder) {
    const workspaceUri = wksFolder.uri;
    logInitProgress(workspaceUri, "Looking for perforce config files");
    const p4ConfigFiles = await findP4ConfigFiles(wksFolder);

    logInitProgress(workspaceUri, "Found " + p4ConfigFiles.length + " config file(s)");

    logInitProgress(workspaceUri, "Finding client roots using each file's directory");
    const rootPromises = p4ConfigFiles.map(async (file) =>
        findClientRoot(vscode.Uri.file(Path.dirname(file.fsPath)))
    );
    const foundRoots = await Promise.all(rootPromises);

    const foundRootsStr = p4ConfigFiles
        .map((f, i) => clientRootLog(f.fsPath, foundRoots[i]))
        .join("\n");
    logInitProgress(
        workspaceUri,
        "Found the following roots from the location of " +
            p4ConfigFiles.length +
            " P4CONFIG file(s):\n" +
            foundRootsStr
    );

    return foundRoots;
}

async function initWorkspace(wksFolder: vscode.WorkspaceFolder) {
    const workspaceUri = wksFolder.uri;

    const overrideDir = PerforceService.getOverrideDir(workspaceUri);
    const activationMode = getActivationMode();
    const shouldAlwaysActivate = activationMode === "always";

    logInitProgress(
        workspaceUri,
        "Trying to initialise SCM Providers in this workspace.\n\tNote: the following overrides apply in this workspace:\n" +
            getOverrideInfo(workspaceUri) +
            "\n\tExplicit overrides may prevent auto-detection of other perforce client workspaces\n" +
            "Looking for a client root using the workspace root directory"
    );

    const workspaceClientRoot = await findClientRoot(workspaceUri);

    if (!workspaceClientRoot) {
        logInitProgress(workspaceUri, "NO CLIENT ROOT FOUND in workspace root directory");
    } else {
        logInitProgress(
            workspaceUri,
            "Found workspace using root directory\n" +
                clientRootLog(
                    "VS Code workspace root directory",
                    workspaceClientRoot,
                    !!overrideDir,
                    shouldAlwaysActivate
                )
        );
    }

    const allRoots: (ClientRoot | undefined)[] = [];

    if (overrideDir) {
        // if workspace is not in client root but p4dir is set, just use the client found.
        // don't care about anything else because p4dir pretty much overrides everything
        logInitProgress(
            workspaceUri,
            "NOT scanning for P4CONFIG files due to working directory override"
        );
    } else {
        const enableP4ConfigScan = vscode.workspace
            .getConfiguration("perforce", workspaceUri)
            .get<boolean>("enableP4ConfigScanOnStartup");

        if (!enableP4ConfigScan) {
            logInitProgress(
                workspaceUri,
                "NOT scanning for P4CONFIG files because perforce.enableP4ConfigScanOnStartup is set to false"
            );
        } else {
            const foundRoots = await findClientRootsForP4Configs(wksFolder);
            allRoots.push(...foundRoots.filter(isTruthy));
        }
    }

    allRoots.push(workspaceClientRoot);

    const filteredRoots = allRoots
        .filter(isTruthy)
        .filter((r) => r.isInRoot || r.isAboveRoot);

    const helpMsg =
        "If you were expecting a valid client to be found:\n" +
        "  * Check if you can run perforce commands in this directory from the command line.\n" +
        "  * Look at the perforce commands above, see if they match your expectations and can be run in the directory shown.\n" +
        "  * Review your override settings in vscode, perforce.port, perforce.user, perforce.client, perforce.dir\n" +
        "    * you may need to set or unset them appropriately";

    if (filteredRoots.length < 1) {
        if (allRoots.length > 0) {
            setActivationContext("foundOutOfRoot", true);
        }
        if (shouldAlwaysActivate) {
            if (workspaceClientRoot) {
                logInitProgress(
                    workspaceUri,
                    "NO valid perforce clients found in this directory, but activation mode is set to ALWAYS and a perforce client was found with a different client root\n" +
                        helpMsg +
                        "\n" +
                        "Creating SCM Provider using the workspace found in the root directory."
                );

                initClientRoots(workspaceUri, workspaceClientRoot);
            } else {
                logInitProgress(
                    workspaceUri,
                    "NO valid perforce clients found in this directory." +
                        "Activation mode is set to ALWAYS, but cannot create an scm provider without any client found.\n" +
                        "Note: It should still be possible to use perforce commands on individual files in the editor.\n" +
                        helpMsg
                );
            }
        } else {
            logInitProgress(
                workspaceUri,
                "NO valid perforce clients found in this directory.\n" + helpMsg
            );
            if (workspaceClientRoot) {
                logInitProgress(
                    workspaceUri,
                    "To FORCE activation for the client '" +
                        workspaceClientRoot.clientName +
                        "':\n\tset perforce.activationMode to always.\nThis should allow you to view and manage changelists in that client, but is unlikely to be useful for files in this workspace"
                );
            }
        }
    } else {
        initClientRoots(workspaceUri, ...filteredRoots);
    }
    setActivationContext("status", "complete");
    // TODO
    // probably the scm provider should accumulate all dirs used to find it, so that when
    // folders are files are removed we know if we still need the scm provider
}

function removeWorkspace(wksFolder: vscode.WorkspaceFolder) {
    logInitProgress(
        wksFolder.uri,
        "This workspace was removed. Checking for SCM providers that used it"
    );
    PerforceSCMProvider.removeContributingDirsUnder(wksFolder.uri);
}

export async function activate(ctx: vscode.ExtensionContext) {
    // ALWAYS register the edit and save command
    PerforceCommands.registerImportantCommands(_disposable);

    ctx.subscriptions.push(
        new vscode.Disposable(() => Disposable.from(..._disposable).dispose())
    );

    const activationMode = vscode.workspace
        .getConfiguration("perforce")
        .get("activationMode");
    if (activationMode === "off") {
        return;
    }

    doOneTimeRegistration();

    if (activationMode === "always") {
        Display.activateStatusBar();
    }

    vscode.workspace.onDidChangeWorkspaceFolders(
        onDidChangeWorkspaceFolders,
        null,
        ctx.subscriptions
    );

    vscode.workspace.onDidChangeConfiguration(
        onDidChangeConfiguration,
        null,
        ctx.subscriptions
    );

    await onDidChangeWorkspaceFolders({
        added: vscode.workspace.workspaceFolders || [],
        removed: [],
    });

    // don't get events for these when the editor first loads
    vscode.workspace.textDocuments.map(onDidOpenTextDocument);
}

function doOneTimeRegistration() {
    if (!_isRegistered) {
        _isRegistered = true;

        QuickPicks.registerQuickPicks();

        Display.channel.appendLine(
            "Performing one-time registration of perforce commands"
        );

        Display.initialize(_disposable);
        ContextVars.initialize(_disposable);

        _perforceContentProvider = new PerforceContentProvider();
        _disposable.push(_perforceContentProvider);

        _disposable.push(
            AnnotationProvider.onWillLoadEditor((uri) =>
                _perforceContentProvider?.requestUpdatedDocument(uri)
            )
        );

        _disposable.push(vscode.workspace.onDidOpenTextDocument(onDidOpenTextDocument));
        _disposable.push(vscode.workspace.onDidCloseTextDocument(onDidCloseTextDocument));

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
    "perforce.bottleneck.maxConcurrent",
];

const settingsRequiringRefresh = [
    "perforce.hideEmptyChangelists",
    "perforce.hideNonWorkspaceFiles",
    "perforce.hideShelvedFiles",
    "perforce.ignoredChangelistPrefix",
];

let didShowConfigWarning = false;

function checkSettings(
    event: vscode.ConfigurationChangeEvent,
    settings: string[],
    action: (setting: string) => void | Promise<void>,
    breakOnMatch?: boolean
) {
    for (const setting of settings) {
        if (event.affectsConfiguration(setting)) {
            action(setting);
            if (breakOnMatch) {
                break;
            }
        }
    }
}

function onDidChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
    if (!didShowConfigWarning) {
        checkSettings(
            event,
            settingsRequiringRestart,
            async () => {
                didShowConfigWarning = true;
                const restart = "Restart Now";
                const answer = await vscode.window.showWarningMessage(
                    "You have changed a perforce setting that may require a restart to take effect. When you are done, please restart VS Code",
                    restart
                );
                if (answer === restart) {
                    vscode.commands.executeCommand("workbench.action.reloadWindow");
                }
            },
            true
        );
    }
    checkSettings(
        event,
        settingsRequiringRefresh,
        () => PerforceSCMProvider.RefreshAll(),
        true
    );
    if (
        event.affectsConfiguration("perforce.scm.activateOnFileOpen") &&
        vscode.workspace.getConfiguration("perforce").get("scm.activateOnFileOpen") &&
        getActivationMode() !== "off"
    ) {
        // refresh the set of open documents when enabled
        vscode.workspace.textDocuments.map(onDidOpenTextDocument);
    }
}

async function onDidChangeWorkspaceFolders(
    event: vscode.WorkspaceFoldersChangeEvent
): Promise<void> {
    const added = event.added;
    const removed = event.removed;
    Display.channel.appendLine(
        "==============================\nWorkspace folders changed. Starting initialisation.\n"
    );

    try {
        if (added.length > 0) {
            Display.channel.appendLine("Workspaces were added");
        } else {
            Display.channel.appendLine(
                "No new workspaces were added - nothing to initialise"
            );
            setActivationContext("status", "noworkspace");
        }
        for (const workspace of added) {
            await initWorkspace(workspace);
            //await TryCreateP4(workspace.uri);
        }
    } catch (err) {
        Display.channel.appendLine("Error: " + err);
    }

    try {
        if (removed.length > 0) {
            Display.channel.appendLine("Workspaces were removed");
            for (const workspace of removed) {
                removeWorkspace(workspace);
            }
            const removedScms = PerforceSCMProvider.disposeInstancesWithoutContributors();

            Display.channel.appendLine(
                "\t>>> Removed " +
                    removedScms.length +
                    " SCM provider(s) with no remaining contributing workspaces"
            );
        }
    } catch (err) {
        Display.channel.appendLine("Error: " + err);
    }

    Display.channel.appendLine(
        "\nInitialisation finished\n==============================\n"
    );
}

function logFileMessage(file: vscode.Uri, message: string, debug?: boolean) {
    if (debug && !vscode.workspace.getConfiguration("perforce").get("debugModeActive")) {
        return;
    }
    Display.channel.appendLine("\t>>> " + Path.basename(file.fsPath) + " : " + message);
}

async function initForUnknownDoc(event: vscode.TextDocument) {
    const uri = event.uri;
    const dir = vscode.Uri.file(Path.dirname(uri.fsPath));

    if (_dirsWithNoClient.has(dir.fsPath)) {
        logFileMessage(uri, "Already determined no client here", true);
        return;
    }

    const client = await findClientRoot(dir);
    logFileMessage(uri, clientRootLog(uri.fsPath, client), true);
    if (client && (client.isInRoot || client?.isAboveRoot)) {
        const instance = PerforceSCMProvider.GetInstanceByClient(client);
        if (instance) {
            logFileMessage(
                uri,
                "Already have an SCM provider for client " + client.clientName,
                true
            );
            instance.addContributingDoc(event);
        } else {
            logFileMessage(
                uri,
                "Creating SCM provider for " +
                    client.clientName +
                    " @ " +
                    client.clientRoot.fsPath +
                    " because of source " +
                    uri.fsPath
            );
            const scm = initScmProvider(client);
            scm.addContributingDoc(event);
        }
    } else {
        _dirsWithNoClient.add(dir.fsPath);
        logFileMessage(uri, "NOT creating an SCM provider", true);
    }
}

async function onDidOpenTextDocument(event: vscode.TextDocument) {
    const uri = event.uri;
    if (uri.scheme !== "file") {
        return;
    }
    if (!vscode.workspace.getConfiguration("perforce").get("scm.activateOnFileOpen")) {
        return;
    }
    logFileMessage(uri, "Editor opened " + event.uri.fsPath, true);
    if (!PerforceSCMProvider.checkAndAddContributingDoc(event)) {
        await initForUnknownDoc(event);
    } else {
        logFileMessage(
            uri,
            "Already have an SCM provider for this doc or a parent directory",
            true
        );
    }
}

function onDidCloseTextDocument(event: vscode.TextDocument) {
    if (event.uri.scheme !== "file") {
        return;
    }

    // even if de-activation is disabled, keep track of which files were removed
    const removedFrom = PerforceSCMProvider.removeContributingDoc(event);

    if (!vscode.workspace.getConfiguration("perforce").get("scm.deactivateOnFileClose")) {
        return;
    }
    if (removedFrom.length > 0) {
        logFileMessage(
            event.uri,
            "Closed document " +
                event.uri.fsPath +
                " WAS contributing to an SCM provider. Checking if it can be removed"
        );
        const removed = PerforceSCMProvider.disposeInstancesWithoutContributors();
        logFileMessage(event.uri, "Removed " + removed.length + " SCM providers");
    }
}
