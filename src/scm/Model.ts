import { IPerforceConfig } from "./../PerforceService";
import {
    Uri,
    EventEmitter,
    Event,
    SourceControl,
    SourceControlResourceGroup,
    Disposable,
    ProgressLocation,
    window,
    workspace,
    commands
} from "vscode";
import { WorkspaceConfigAccessor } from "../ConfigService";
import { Utils } from "../Utils";
import { Display, ActiveStatusEvent, ActiveEditorStatus } from "../Display";
import { Resource } from "./Resource";

import * as Path from "path";
import * as vscode from "vscode";
import { DebouncedFunction, debounce } from "../Debounce";
import * as p4 from "../api/PerforceApi";
import { ChangeInfo } from "../api/CommonTypes";

function isResourceGroup(arg: any): arg is SourceControlResourceGroup {
    return arg && arg.id !== undefined;
}

export type FstatInfo = {
    depotFile: string;
    [key: string]: string;
};

export interface ResourceGroup extends SourceControlResourceGroup {
    model: Model;
    chnum: string;
    isDefault: boolean;
}

export class Model implements Disposable {
    private _disposables: Disposable[] = [];

    private _onDidChange = new EventEmitter<void>();
    public get onDidChange(): Event<void> {
        return this._onDidChange.event;
    }

    private _refreshInProgress = false;

    public dispose() {
        this.clean();
        if (this._disposables) {
            this._disposables.forEach(d => d.dispose());
            this._disposables = [];
        }
    }

    private _infos = new Map<string, string>();

    private _defaultGroup?: ResourceGroup;
    private _pendingGroups = new Map<
        number,
        { description: string; group: ResourceGroup }
    >();
    private _openResourcesByPath = new Map<string, Resource>();
    /**
     * The set of local paths we are known NOT to have #have revisions of.
     * Cleared on refresh
     */
    private _knownHaveListByPath = new Map<string, boolean>();

    /**
     * Stores the set of files where the display has checked
     * if the file is open and returned that it is not, but
     * the model believes it is open - so that we know there may
     * be a conflict when trying to perform automatic operations
     * like opening a modified filed to edit, after it was just
     * submitted externally
     */
    private _conflictsByPath = new Set<string>();

    private _refresh: DebouncedFunction<any[], Promise<void>>;

    get workspaceUri() {
        return this._workspaceUri;
    }

    private get clientName(): string | undefined {
        return this._infos.get("Client name") ?? this._config.p4Client;
    }

    public get ResourceGroups(): ResourceGroup[] {
        const result: ResourceGroup[] = [];

        if (this._defaultGroup) {
            result.push(this._defaultGroup);
        }

        this._pendingGroups.forEach(value => {
            const config = workspace.getConfiguration("perforce");
            if (
                config.get<boolean>("hideEmptyChangelists") &&
                value.group.resourceStates.length === 0
            ) {
                value.group.dispose();
            } else {
                result.push(value.group);
            }
        });

        return result;
    }

    public constructor(
        private _config: IPerforceConfig,
        private _workspaceUri: Uri,
        private _workspaceConfig: WorkspaceConfigAccessor,
        public _sourceControl: SourceControl
    ) {
        this._refresh = debounce<(boolean | undefined)[], Promise<void>>(
            this.RefreshImpl.bind(this),
            _workspaceConfig.refreshDebounceTime,
            () => (this._refreshInProgress = true)
        );
        this._disposables.push(this._refresh);
        this._disposables.push(
            Display.onActiveFileStatusKnown(this.checkForConflicts.bind(this))
        );
    }

    private assertIsNotDefault(input: ResourceGroup) {
        if (input.isDefault) {
            throw new Error("The default changelist is not valid for this operation");
        }
    }

    private assertIsDefault(input: ResourceGroup) {
        if (!input.isDefault) {
            throw new Error(
                "The non-default changelist '" +
                    input.chnum +
                    "' is not valid for this operation"
            );
        }
    }

    public mayHaveConflictForFile(uri: Uri) {
        return (
            this._conflictsByPath.has(uri.fsPath) ||
            (this._refreshInProgress && this._openResourcesByPath.has(uri.fsPath))
        );
    }

    private checkForConflicts(event: ActiveStatusEvent) {
        if (this._refreshInProgress || this._conflictsByPath.has(event.file.fsPath)) {
            // don't check anything while a refresh is in progress
            return;
        }
        if (event.status === ActiveEditorStatus.NOT_OPEN) {
            const openFile = this.getOpenResource(event.file);
            if (openFile) {
                Display.channel.appendLine(
                    "Detected conflicting status for file " +
                        event.file +
                        "\nSCM provider believes the file is open, but latest 'opened' call does not.\n" +
                        "This is probably caused by an external change such as submitting or reverting the file from another application."
                );
                // does not refresh immediately to prevent the possibility of infinite refreshing
                // only stores the fact that there is a conflict to override checks in other places (file system watcher)
                this._conflictsByPath.add(event.file.fsPath);
            }
        }
    }

    public async Sync(): Promise<void> {
        const loggedin = await p4.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        window.withProgress(
            {
                location: ProgressLocation.SourceControl,
                title: "Syncing..."
            },
            () => this.syncUpdate()
        );
    }

    public async Refresh() {
        await this._refresh.withoutLeadingCall();
    }

    public async RefreshPolitely() {
        await this._refresh(true);
    }

    public async RefreshImmediately() {
        await this.RefreshImpl(true);
    }

    /**
     * Gets the resource for a local file if it is open in the workspace (not shelved)
     * @param localFile
     */
    public getOpenResource(localFile: Uri) {
        return this._openResourcesByPath.get(localFile.fsPath);
    }

    /**
     * Checks whether we have a #have revision for a given file in the perforce client
     * The first call after a refresh is cached
     * @param uri the local file to check
     */
    public async haveFile(uri: Uri): Promise<boolean> {
        const cachedHave = this._knownHaveListByPath.get(uri.fsPath);
        if (cachedHave !== undefined) {
            return cachedHave;
        }
        const ret = await p4.haveFile(uri, { file: { fsPath: uri.fsPath } });

        this._knownHaveListByPath.set(uri.fsPath, ret);

        return ret;
    }

    private async RefreshImpl(refreshClientInfo?: boolean): Promise<void> {
        // don't clean the changelists now - this will be done by updateStatus
        // seeing an empty scm view and waiting for it to populate makes it feel slower.
        this._refreshInProgress = true;

        const loggedin = await p4.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        if (!this.clientName || refreshClientInfo) {
            await window.withProgress(
                {
                    location: ProgressLocation.SourceControl,
                    title: "Updating info..."
                },
                () => this.updateInfo()
            );
        }
        await window.withProgress(
            {
                location: ProgressLocation.SourceControl,
                title: "Updating status..."
            },
            () => this.updateStatus()
        );
    }

    public async Info(): Promise<void> {
        const resource = this._sourceControl.rootUri;
        if (resource) {
            Display.channel.show();

            const output = await p4.info(resource, {});
            Display.channel.append(output);
        }
    }
    private isInWorkspace(clientFile?: string): boolean {
        return !!clientFile && !!workspace.getWorkspaceFolder(Uri.file(clientFile));
    }

    public async SaveToChangelist(
        descStr: string,
        existingChangelist?: string
    ): Promise<string | undefined> {
        if (!descStr) {
            descStr = "<saved by VSCode>";
        }

        const changeFields = await p4.getChangeSpec(this._workspaceUri, {
            existingChangelist
        });

        if (this._workspaceConfig.hideNonWorkspaceFiles && changeFields.files) {
            const infos = await p4.getFstatInfo(this._workspaceUri, {
                depotPaths: changeFields.files.map(file => file.depotPath)
            });

            changeFields.files = changeFields.files.filter((_file, i) =>
                this.isInWorkspace(infos[i]?.["clientFile"])
            );
        }
        changeFields.description = descStr;

        let newChangelistNumber: string | undefined;
        try {
            const created = await p4.inputChangeSpec(this._workspaceUri, {
                spec: changeFields
            });

            newChangelistNumber = created.chnum;
            Display.channel.append(created.rawOutput);
            this.Refresh();
        } catch (err) {
            Display.showError(err.toString());
        }

        return newChangelistNumber;
    }

    private async createEmptyChangelist(descStr: string) {
        try {
            const changeFields = await p4.getChangeSpec(this._workspaceUri, {});
            changeFields.files = [];
            changeFields.description = descStr;
            const created = await p4.inputChangeSpec(this._workspaceUri, {
                spec: changeFields
            });
            return created.chnum;
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    public async ProcessChangelist(): Promise<void> {
        let description = this._sourceControl.inputBox.value;
        this._sourceControl.inputBox.value = "";

        let existingChangelist = "";
        const matches = new RegExp(/^#(\d+)\r?\n([^]+)/).exec(description);
        if (matches) {
            existingChangelist = matches[1];
            description = matches[2];
        }

        await this.SaveToChangelist(description, existingChangelist);
    }

    public async EditChangelist(input: ResourceGroup): Promise<void> {
        const id = input.chnum;

        const change = await p4.getChangeSpec(this._workspaceUri, {
            existingChangelist: id
        });

        this._sourceControl.inputBox.value = "#" + id + "\n" + change.description ?? "";
    }

    public async Describe(input: ResourceGroup): Promise<void> {
        if (input.isDefault) {
            const command = "change";
            const args = "-o";
            const uri: Uri = Uri.parse("perforce:").with({
                query: Utils.makePerforceUriQuery(command, args)
            });
            await commands.executeCommand<void>("vscode.open", uri);
        } else {
            const command = "describe";
            const args = input.chnum;

            const uri: Uri = Uri.parse("perforce:").with({
                query: Utils.makePerforceUriQuery(command, args)
            });
            await commands.executeCommand<void>("vscode.open", uri);
        }
    }

    public async SubmitDefault(): Promise<void> {
        const loggedin = await p4.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        try {
            const files = await p4.getOpenedFiles(this._workspaceUri, {
                chnum: "default"
            });
            if (files.length === 0) {
                throw new Error("The default changelist is empty");
            }
        } catch (err) {
            Display.showError(err.toString());
            return;
        }

        const descStr = await this.requestChangelistDescription();

        if (descStr === undefined) {
            return;
        }

        const pick = await vscode.window.showQuickPick(
            ["Submit", "Save Changelist", "Cancel"],
            {
                ignoreFocusOut: true
            }
        );

        if (!pick || pick === "Cancel") {
            return;
        }

        if (pick === "Submit") {
            if (this._workspaceConfig.hideNonWorkspaceFiles) {
                // TODO - relies on state - i.e. that savetochangelist applies hideNonWorkspaceFiles
                const changeListNr = await this.SaveToChangelist(descStr);

                if (changeListNr !== undefined) {
                    await p4.submitChangelist(this._workspaceUri, {
                        chnum: changeListNr
                    });
                }
            } else {
                await p4.submitChangelist(this._workspaceUri, {
                    description: descStr
                });
            }
        } else {
            await this.SaveToChangelist(descStr);
        }
        this.Refresh();
    }

    public async Submit(input: ResourceGroup): Promise<void> {
        this.assertIsNotDefault(input);

        await p4.submitChangelist(this._workspaceUri, { chnum: input.chnum });
        Display.showMessage("Changelist Submitted");
        this.Refresh();
    }

    private hasShelvedFiles(group: SourceControlResourceGroup) {
        return group.resourceStates.some(resource => (resource as Resource).isShelved);
    }

    public async Revert(
        input: Resource | ResourceGroup,
        unchanged?: boolean
    ): Promise<void> {
        let needRefresh = false;

        const opts: p4.RevertOptions = { paths: [], unchanged };

        let message = "Are you sure you want to revert the changes ";
        if (input instanceof Resource) {
            if (input.isShelved) {
                Display.showImportantError(
                    "Revert cannot be used on shelved file: " +
                        Path.basename(input.uri.fsPath)
                );
                return;
            }
            opts.paths = [{ fsPath: input.resourceUri.fsPath }];
            message += "to file " + Path.basename(input.resourceUri.fsPath) + "?";
        } else if (isResourceGroup(input)) {
            opts.paths = ["//..."];
            opts.chnum = input.chnum;
            if (input.isDefault) {
                message += "in the default changelist?";
            } else {
                message += "in the changelist " + input.chnum + "?";
            }
        } else {
            return;
        }

        if (!unchanged) {
            const yes = "Revert Changes";
            const pick = await window.showWarningMessage(message, { modal: true }, yes);
            if (pick !== yes) {
                return;
            }
        }

        try {
            const output = await p4.revert(this._workspaceUri, opts);
            Display.updateEditor();
            Display.channel.append(output);
            needRefresh = true;
        } catch {
            // p4 shows error
        }

        // delete changelist after
        if (isResourceGroup(input) && !this.hasShelvedFiles(input) && !input.isDefault) {
            try {
                const output = await p4.deleteChangelist(this._workspaceUri, {
                    chnum: input.chnum
                });
                Display.updateEditor();
                Display.channel.append(output);
                needRefresh = true;
            } catch {
                // p4 shows error
            }
        }

        if (needRefresh) {
            this.Refresh();
        }
    }

    public async QuietlyRevertChangelist(chnum: string): Promise<void> {
        const output = await p4.revert(this._workspaceUri, {
            chnum: chnum,
            paths: ["//..."]
        });
        Display.updateEditor();
        Display.channel.append(output);
    }

    public async ShelveChangelist(input: ResourceGroup, revert?: boolean): Promise<void> {
        if (input.isDefault) {
            throw new Error("Cannot shelve the default changelist");
        }

        try {
            await p4.shelve(this._workspaceUri, { chnum: input.chnum, force: true });
            if (revert) {
                await this.QuietlyRevertChangelist(input.chnum);
            }
            Display.showMessage("Changelist shelved");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
        this.Refresh();
    }

    public async UnshelveChangelist(input: ResourceGroup): Promise<void> {
        if (input.isDefault) {
            throw new Error("Cannot unshelve the default changelist");
        }

        try {
            await p4.unshelve(this._workspaceUri, {
                shelvedChnum: input.chnum,
                toChnum: input.chnum,
                force: true
            });
            this.Refresh();
            Display.showMessage("Changelist unshelved");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    public async DeleteShelvedChangelist(input: ResourceGroup): Promise<void> {
        if (input.isDefault) {
            throw new Error("Cannot delete shelved files from the default changelist");
        }

        const message =
            "Are you sure you want to delete the shelved files from changelist " +
            input.chnum +
            "?";

        const yes = "Delete Shelved Files";
        const pick = await window.showWarningMessage(message, { modal: true }, yes);
        if (pick !== yes) {
            return;
        }

        try {
            await p4.shelve(this._workspaceUri, {
                chnum: input.chnum,
                delete: true
            });
            this.Refresh();
            Display.showMessage("Shelved files deleted");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    public async ShelveOrUnshelve(input: Resource): Promise<void> {
        if (input.isShelved) {
            try {
                await p4.unshelve(this._workspaceUri, {
                    toChnum: input.change,
                    shelvedChnum: input.change,
                    paths: [input.depotPath]
                });
                const output = await p4.shelve(this._workspaceUri, {
                    chnum: input.change,
                    delete: true,
                    paths: [input.depotPath]
                });
                Display.updateEditor();
                Display.channel.append(output);
            } catch (reason) {
                Display.showImportantError(reason.toString());
            }
            this.Refresh();
        } else {
            try {
                await p4.shelve(this._workspaceUri, {
                    chnum: input.change,
                    force: true,
                    paths: [{ fsPath: input.resourceUri.fsPath }]
                });
                await this.Revert(input);
            } catch (reason) {
                Display.showImportantError(reason.toString());
            }
            this.Refresh();
        }
    }

    public async DeleteShelvedFile(input: Resource): Promise<void> {
        if (!input.isShelved) {
            Display.showImportantError(
                "Shelve cannot be used on normal file: " + Path.basename(input.uri.fsPath)
            );
            return;
        }

        const yes = "Delete shelved file";
        const answer = await window.showWarningMessage(
            "Are you sure you want to delete the shelved file " + input.depotPath,
            { modal: true },
            yes
        );

        if (answer === undefined) {
            return;
        }

        try {
            const ret = await p4.shelve(this._workspaceUri, {
                delete: true,
                chnum: input.change,
                paths: [input.depotPath]
            });
            this.Refresh();
            Display.showMessage(ret);
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    private async requestJobId(chnum: string) {
        const re = new RegExp(/^[a-z0-9]+$/i);
        return await window.showInputBox({
            prompt: "Enter the job to be fixed by changelist " + chnum,
            placeHolder: "jobNNNNN",
            validateInput: val => {
                if (val.trim() === "") {
                    return "Enter a job name";
                }
                if (!re.exec(val)) {
                    return "Job names can only contain letters and numbers";
                }
            }
        });
    }

    public async FixJob(input: ResourceGroup) {
        if (input.isDefault) {
            throw new Error("The default changelist cannot fix a job");
        }

        const jobId = await this.requestJobId(input.chnum);
        if (jobId === undefined) {
            return;
        }

        try {
            await p4.fixJob(this._workspaceUri, { chnum: input.chnum, jobId });
            this.Refresh();
            Display.showMessage("Job " + jobId + " added");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    private async pickJobFromChangelist(chnum: string) {
        const allJobs = await p4.getFixedJobs(this._workspaceUri, { chnum });

        const items = allJobs.map(
            (job): vscode.QuickPickItem => {
                return {
                    description: job.description[0],
                    label: job.id,
                    detail: job.description.slice(1).join(" ")
                };
            }
        );

        if (items.length === 0) {
            Display.showModalMessage(
                "Changelist " + chnum + " does not have any jobs attached"
            );
            return;
        }

        const job = await window.showQuickPick(items, {
            placeHolder: "Select a job to remove",
            matchOnDescription: true,
            matchOnDetail: true
        });

        return job;
    }

    public async UnfixJob(input: ResourceGroup) {
        if (input.isDefault) {
            throw new Error("The default changelist cannot fix a job");
        }

        const job = await this.pickJobFromChangelist(input.chnum);

        if (job === undefined) {
            return;
        }

        const jobId = job.label;

        try {
            await p4.fixJob(this._workspaceUri, {
                chnum: input.chnum,
                jobId,
                removeFix: true
            });
            this.Refresh();
            Display.showMessage("Job " + jobId + " removed");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    private async requestChangelistDescription() {
        const newText = await window.showInputBox({
            prompt: "Enter the new changelist's description",
            validateInput: val => {
                if (val.trim() === "") {
                    return "Description must not be empty";
                }
            }
        });

        return newText;
    }

    private async createEmptyChangelistInteractively() {
        const newText = await this.requestChangelistDescription();
        return newText ? await this.createEmptyChangelist(newText) : undefined;
    }

    public async ReopenFile(resources: Resource[]): Promise<void> {
        if (resources.some(r => r.isShelved)) {
            Display.showImportantError("Cannot reopen a shelved file");
            throw new Error("Cannot reopen shelved file");
        }

        const loggedin = await p4.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        const items = [];
        items.push({
            id: "default",
            label: this._defaultGroup?.label ?? "Default Changelist",
            description: ""
        });
        items.push({ id: "new", label: "New Changelist...", description: "" });
        this._pendingGroups.forEach((value, key) => {
            items.push({
                id: key.toString(),
                label: "#" + key.toString(),
                description: value.description
            });
        });

        const selection = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: "Choose a changelist:"
        });

        if (selection === undefined) {
            return;
        }

        const chnum =
            selection.id === "new"
                ? await this.createEmptyChangelistInteractively()
                : selection.id;

        if (chnum === undefined) {
            return;
        }

        try {
            const output = await p4.reopenFiles(this._workspaceUri, {
                chnum: chnum,
                files: resources.map(resource => {
                    return { fsPath: resource.resourceUri.fsPath };
                })
            });
            Display.channel.append(output);
        } catch (reason) {
            Display.showImportantError(reason.toString());
        }
        this.Refresh();
    }

    private clean() {
        this._openResourcesByPath.clear();
        this._conflictsByPath.clear();
        this._knownHaveListByPath.clear();

        if (this._defaultGroup) {
            this._defaultGroup.dispose();
            this._defaultGroup = undefined;
        }

        this._pendingGroups.forEach(value => value.group.dispose());
        this._pendingGroups.clear();

        this._onDidChange.fire();
    }

    private async syncUpdate(): Promise<void> {
        const trailingSlash = /^(.*)(\/)$/;
        const config = this._config;
        let pathToSync;
        let p4Dir = config.p4Dir ? config.p4Dir : this._workspaceConfig.pwdOverride;
        if (p4Dir && p4Dir !== "none") {
            p4Dir = Utils.normalize(p4Dir);
            if (!trailingSlash.exec(p4Dir)) {
                p4Dir += "/";
            }
            pathToSync = vscode.Uri.file(p4Dir + "...");
        }

        try {
            const output = await p4.sync(this._workspaceUri, {
                files: pathToSync ? [{ fsPath: pathToSync.fsPath }] : []
            });
            Display.channel.append(output);
            this.Refresh();
        } catch (reason) {
            Display.showImportantError(reason.toString());
        }
    }

    private async updateInfo(): Promise<void> {
        this._infos = await p4.getInfo(Uri.file(this._config.localDir), {});
    }

    private async updateStatus(): Promise<void> {
        const loggedin = await p4.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        const changelists = await this.getChanges();
        const shelvedPromise = this.getAllShelvedResources(changelists);
        const openPromise = this.getDepotOpenedResources();
        const [shelvedResources, openResources] = await Promise.all([
            shelvedPromise,
            openPromise
        ]);
        this.createResourceGroups(changelists, shelvedResources.concat(openResources));

        this._refreshInProgress = false;
        this._onDidChange.fire();
    }

    private makeResourceForOpenFile(fstatInfo: FstatInfo): Resource | undefined {
        const clientFile = fstatInfo["clientFile"];
        const change = fstatInfo["change"];
        const action = fstatInfo["action"];
        const headType = fstatInfo["headType"];
        const depotPath = Uri.file(fstatInfo["depotFile"]);

        const uri = Uri.file(clientFile);
        if (this._workspaceConfig.hideNonWorkspaceFiles) {
            const workspaceFolder = workspace.getWorkspaceFolder(uri);
            if (!workspaceFolder) {
                return;
            }
        }
        const resource: Resource = new Resource(
            this,
            depotPath,
            uri,
            change,
            false,
            action,
            fstatInfo,
            headType
        );

        return resource;
    }

    private createResourceGroups(changelists: ChangeInfo[], resources: Resource[]) {
        if (!this._sourceControl) {
            throw new Error("Source control not initialised");
        }
        const sc = this._sourceControl;

        this.clean();

        this._defaultGroup = this._sourceControl.createResourceGroup(
            "default",
            "Default Changelist"
        ) as ResourceGroup;
        this._defaultGroup.isDefault = true;
        this._defaultGroup.model = this;
        this._defaultGroup.chnum = "default";
        this._defaultGroup.resourceStates = resources.filter(
            (resource): resource is Resource =>
                !!resource && resource.change === "default"
        );

        const groups = changelists.map(c => {
            const group = sc.createResourceGroup(
                "pending:" + c.chnum,
                "#" + c.chnum + ": " + c.description
            ) as ResourceGroup;
            group.model = this;
            group.isDefault = false;
            group.chnum = c.chnum.toString();
            group.resourceStates = resources.filter(
                (resource): resource is Resource =>
                    !!resource && resource.change === c.chnum.toString()
            );
            return group;
        });

        resources.forEach(resource => {
            if (!resource.isShelved && resource.underlyingUri) {
                this._openResourcesByPath.set(resource.underlyingUri.fsPath, resource);
            }
        });

        groups.forEach((group, i) => {
            this._pendingGroups.set(parseInt(changelists[i].chnum), {
                description: changelists[i].description,
                group: group
            });
        });
    }

    private async getChanges(): Promise<ChangeInfo[]> {
        const changes = this.filterIgnoredChangelists(
            await p4.getChangelists(this._workspaceUri, {
                client: this.clientName,
                status: p4.ChangelistStatus.PENDING
            })
        );

        return this._workspaceConfig.changelistOrder === "ascending"
            ? changes.reverse()
            : changes;
    }

    private filterIgnoredChangelists(changelists: ChangeInfo[]): ChangeInfo[] {
        const prefix = this._workspaceConfig.ignoredChangelistPrefix;
        if (prefix) {
            changelists = changelists.filter(c => !c.description.startsWith(prefix));
        }
        return changelists;
    }

    private async getAllShelvedResources(changes: ChangeInfo[]): Promise<Resource[]> {
        if (this._workspaceConfig.hideShelvedFiles || changes.length === 0) {
            return [];
        }
        const allFileInfo = await p4.getShelvedFiles(this._workspaceUri, {
            chnums: changes.map(c => c.chnum)
        });
        return this.getShelvedResources(allFileInfo);
    }

    private makeResourceForShelvedFile(chnum: string, fstatInfo: FstatInfo) {
        const underlyingUri = Uri.file(fstatInfo["clientFile"]);

        const resource: Resource = new Resource(
            this,
            Uri.file(fstatInfo.depotFile),
            underlyingUri,
            chnum,
            true,
            fstatInfo["action"],
            fstatInfo
        );
        return resource;
    }

    private async getShelvedResources(
        files: p4.ShelvedChangeInfo[]
    ): Promise<Resource[]> {
        const proms = files.map(f =>
            p4.getFstatInfo(this._workspaceUri, {
                depotPaths: f.paths,
                limitToShelved: true,
                outputPendingRecord: true,
                chnum: f.chnum.toString()
            })
        );
        const fstatInfo = await Promise.all(proms);

        return fstatInfo.flatMap((cur, i) =>
            cur
                .filter((f): f is FstatInfo => !!f)
                .map(f => this.makeResourceForShelvedFile(files[i].chnum.toString(), f))
        );
    }

    private async getDepotOpenedResources(): Promise<Resource[]> {
        const depotPaths = await this.getDepotOpenedFilePaths();
        const fstatInfo = await p4.getFstatInfo(this._workspaceUri, {
            depotPaths,
            outputPendingRecord: true
        });
        return fstatInfo
            .filter((info): info is FstatInfo => !!info) // in case fstat doesn't have output for this file
            .map(info => this.makeResourceForOpenFile(info))
            .filter((resource): resource is Resource => resource !== undefined); // for files out of workspace
    }

    private async getDepotOpenedFilePaths(): Promise<string[]> {
        return await p4.getOpenedFiles(this._workspaceUri, {});
    }
}
