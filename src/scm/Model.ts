import { PerforceService, IPerforceConfig } from "./../PerforceService";
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
import { Display } from "../Display";
import { Resource } from "./Resource";

import * as Path from "path";
import * as vscode from "vscode";
import { DebouncedFunction, debounce } from "../Debounce";

function isResourceGroup(arg: any): arg is SourceControlResourceGroup {
    return arg.id !== undefined;
}

export type FstatInfo = {
    depotFile: string;
    [key: string]: string;
};

type ChangeInfo = { chnum: number; description: string };
type ShelvedChangeInfo = { chnum: number; paths: string[] };

type ChangeFieldRaw = {
    name: string;
    value: string[];
};

type ChangeSpecFile = {
    depotPath: string;
    action: string;
};

type ChangeSpec = {
    description?: string;
    files?: ChangeSpecFile[];
    change?: string;
    rawFields: ChangeFieldRaw[];
};

export interface ResourceGroup extends SourceControlResourceGroup {
    model: Model;
}

export class Model implements Disposable {
    private _disposables: Disposable[] = [];

    private _onDidChange = new EventEmitter<void>();
    public get onDidChange(): Event<void> {
        return this._onDidChange.event;
    }

    private _onRefreshStarted = new EventEmitter<void>();
    public get onRefreshStarted(): Event<void> {
        return this._onRefreshStarted.event;
    }

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
            _workspaceConfig.refreshDebounceTime
        );
        this._disposables.push(this._refresh);
    }

    public async Sync(): Promise<void> {
        const loggedin = await Utils.isLoggedIn(this._workspaceUri);
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

    private async RefreshImpl(refreshClientInfo?: boolean): Promise<void> {
        // don't clean the changelists now - this will be done by updateStatus
        // seeing an empty scm view and waiting for it to populate makes it feel slower.
        this._onRefreshStarted.fire();

        const loggedin = await Utils.isLoggedIn(this._workspaceUri);
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
            try {
                const output = await PerforceService.executeAsPromise(resource, "info");
                Display.channel.append(output);
            } catch (err) {
                Display.showError(err.toString());
            }
        }
    }

    private parseRawField(value: string) {
        if (value.startsWith("\n")) {
            value = value.slice(1);
        }
        return value.split("\n").map(line => line.replace(/^\t/, ""));
    }

    private getBasicField(fields: ChangeFieldRaw[], field: string) {
        return fields.find(i => i.name === field)?.value;
    }

    private async getChangeSpec(existingChangelist?: string): Promise<ChangeSpec> {
        const args = `-o ${existingChangelist ? existingChangelist : ""}`;
        const spec: string = await Utils.runCommand(
            this._workspaceUri,
            "change",
            null,
            null,
            args
        );
        const fields = spec.trim().split(/\n\r?\n/);
        const rawFields = fields
            .filter(field => !field.startsWith("#"))
            .map(field => {
                const colPos = field.indexOf(":");
                const name = field.slice(0, colPos);
                const value = this.parseRawField(field.slice(colPos + 1));
                return { name, value };
            });
        return {
            change: this.getBasicField(rawFields, "Change")?.[0],
            description: this.getBasicField(rawFields, "Description")?.join("\n"),
            files: this.getBasicField(rawFields, "Files")?.map(file => {
                const endOfFileStr = file.indexOf("#");
                return {
                    depotPath: file.slice(0, endOfFileStr).trim(),
                    action: file.slice(endOfFileStr + 2)
                };
            }),
            rawFields
        };
    }

    private async getChangelistFileInfo(
        fileList: ChangeSpecFile[]
    ): Promise<(FstatInfo | undefined)[]> {
        const depotFiles = fileList.map(f => f.depotPath);
        return await this.getFstatInfoForFiles(depotFiles);
    }

    private isInWorkspace(clientFile?: string): boolean {
        return !!clientFile && !!workspace.getWorkspaceFolder(Uri.file(clientFile));
    }

    private getDefinedFields(spec: ChangeSpec): ChangeFieldRaw[] {
        const outFields: ChangeFieldRaw[] = [];

        // add defined fields
        if (spec.change) {
            outFields.push({ name: "Change", value: [spec.change] });
        }
        if (spec.description) {
            outFields.push({ name: "Description", value: spec.description.split("\n") });
        }
        if (spec.files) {
            outFields.push({
                name: "Files",
                value: spec.files.map(file => file.depotPath + "\t# " + file.action)
            });
        }

        return outFields;
    }

    private async inputChangeSpec(spec: ChangeSpec): Promise<string> {
        const outFields = this.getDefinedFields(spec).concat(
            spec.rawFields.filter(
                field => !spec[field.name.toLowerCase() as keyof ChangeSpec]
            )
        );

        const newSpec = outFields
            .map(field => {
                const value = field.value.join("\n\t");
                return field.name + ":\t" + value;
            })
            .join("\n\n");

        const output = await Utils.runCommand(
            this._workspaceUri,
            "change",
            null,
            null,
            "-i",
            null,
            newSpec
        );
        Display.channel.append(output);
        return output;
    }

    private getChangelistNumber(changeCreatedStr: string) {
        const matches = new RegExp(/Change\s(\d+)\screated/).exec(changeCreatedStr);
        // Change #### created with ...
        return matches?.[1];
    }

    public async SaveToChangelist(
        descStr: string,
        existingChangelist?: string
    ): Promise<string | undefined> {
        if (!descStr) {
            descStr = "<saved by VSCode>";
        }

        const changeFields = await this.getChangeSpec(existingChangelist);

        if (this._workspaceConfig.hideNonWorkspaceFiles && changeFields.files) {
            const infos = await this.getChangelistFileInfo(changeFields.files);

            changeFields.files = changeFields.files.filter((file, i) =>
                this.isInWorkspace(infos[i]?.["clientFile"])
            );
        }
        changeFields.description = descStr;

        let newChangelistNumber: string | undefined;
        try {
            const createdStr = await this.inputChangeSpec(changeFields);

            newChangelistNumber = this.getChangelistNumber(createdStr);
            Display.channel.append(createdStr);
            this.Refresh();
        } catch (err) {
            Display.showError(err.toString());
        }

        return newChangelistNumber;
    }

    private async createEmptyChangelist(descStr: string) {
        try {
            const changeFields = await this.getChangeSpec();
            changeFields.files = [];
            changeFields.description = descStr;
            const createdStr = await this.inputChangeSpec(changeFields);
            return this.getChangelistNumber(createdStr);
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

    public async EditChangelist(input: SourceControlResourceGroup): Promise<void> {
        let descStr = "";
        const id = input.id;
        let args = "-o ";
        if (id.startsWith("pending")) {
            const chnum = id.substr(id.indexOf(":") + 1);
            descStr = `#${chnum}\n`;
            args += chnum;
        }

        const output: string = await Utils.runCommand(
            this._workspaceUri,
            "change",
            null,
            null,
            args
        );
        const changeFields = output.trim().split(/\n\r?\n/);
        for (const field of changeFields) {
            if (field.startsWith("Description:")) {
                descStr += field
                    .substr(field.indexOf("\n"))
                    .replace(/\n\t/g, "\n")
                    .trim();
                break;
            }
        }

        this._sourceControl.inputBox.value = descStr;
    }

    public async Describe(input: SourceControlResourceGroup): Promise<void> {
        const id = input.id;

        if (id.startsWith("default")) {
            const command = "change";
            const args = "-o";
            const uri: Uri = Uri.parse("perforce:").with({
                query: Utils.makePerforceUriQuery(command, args)
            });
            await commands.executeCommand<void>("vscode.open", uri);
        } else if (id.startsWith("pending")) {
            const command = "describe";
            const args = id.substr(id.indexOf(":") + 1);

            const uri: Uri = Uri.parse("perforce:").with({
                query: Utils.makePerforceUriQuery(command, args)
            });
            await commands.executeCommand<void>("vscode.open", uri);
        }
    }

    public async SubmitDefault(): Promise<void> {
        const loggedin = await Utils.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        const noFiles = "File(s) not opened on this client.";
        let fileListStr;
        try {
            fileListStr = await Utils.runCommand(
                this._workspaceUri,
                "opened",
                null,
                null,
                "-c default"
            );
            if (fileListStr === noFiles) {
                Display.showError(noFiles);
                return;
            }
        } catch (err) {
            Display.showError(err.toString());
            return;
        }

        const descStr = await vscode.window.showInputBox({
            placeHolder: "New changelist description",
            validateInput: (value: string) => {
                if (!value || value.trim().length === 0) {
                    return "Cannot set empty description";
                }
                return null;
            },
            ignoreFocusOut: true
        });

        if (descStr === undefined || descStr.trim().length === 0) {
            // pressing enter with no other input will still submit the empty string
            Display.showError("Cannot set empty description");
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
                const changeListNr = await this.SaveToChangelist(descStr);

                if (changeListNr !== undefined) {
                    this.Submit(parseInt(changeListNr, 10));
                }
            } else {
                this.Submit(descStr);
            }
            return;
        }

        this.SaveToChangelist(descStr);
    }

    public async Submit(
        input: SourceControlResourceGroup | string | number
    ): Promise<void> {
        const command = "submit";
        let args = "";

        if (typeof input === "string") {
            args = `-d "${input}"`;
        } else if (typeof input === "number") {
            args = `-c ${input}`;
        } else {
            const group = input;
            const id = group.id;
            if (id) {
                const chnum = id.substr(id.indexOf(":") + 1);
                if (id.startsWith("pending")) {
                    args = "-c " + chnum;
                } else if (id.startsWith("shelved")) {
                    args = "-e " + chnum;
                } else {
                    return;
                }
            } else {
                return;
            }
        }

        await Utils.runCommand(this._workspaceUri, command, null, null, args)
            .then(output => {
                Display.channel.append(output);
                Display.showMessage("Changelist Submitted");
                this.Refresh();
            })
            .catch(reason => {
                Display.showError(reason.toString());
            });
    }

    private hasShelvedFiles(group: SourceControlResourceGroup) {
        return group.resourceStates.some(resource => (resource as Resource).isShelved);
    }

    public async Revert(
        input: Resource | SourceControlResourceGroup,
        unchanged?: boolean
    ): Promise<void> {
        const command = "revert";
        let file = null;
        let args = unchanged ? "-a " : "";
        let needRefresh = false;

        let message = "Are you sure you want to revert the changes ";
        if (input instanceof Resource) {
            if (input.isShelved) {
                Display.showImportantError(
                    "Revert cannot be used on shelved file: " +
                        Path.basename(input.uri.fsPath)
                );
                return;
            }
            file = Uri.file(input.resourceUri.fsPath);
            message += "to file " + Path.basename(input.resourceUri.fsPath) + "?";
        } else if (isResourceGroup(input)) {
            const id = input.id;
            if (id.startsWith("default")) {
                args += "-c default //...";
                message += "in the default changelist?";
            } else if (id.startsWith("pending")) {
                const chnum = id.substr(id.indexOf(":") + 1);
                args += "-c " + chnum + " //...";
                message += "in the changelist " + chnum + "?";
            } else {
                return;
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

        await Utils.runCommand(this._workspaceUri, command, file, null, args)
            .then(output => {
                Display.updateEditor();
                Display.channel.append(output);
                needRefresh = true;
            })
            .catch(reason => {
                Display.showError(reason.toString());
            });

        // delete changelist after
        if (isResourceGroup(input) && !this.hasShelvedFiles(input)) {
            const command = "change";
            const id = input.id;
            const chnum = id.substr(id.indexOf(":") + 1);
            if (id.startsWith("pending")) {
                args = "-d " + chnum;

                await Utils.runCommand(this._workspaceUri, command, null, null, args)
                    .then(output => {
                        Display.updateEditor();
                        Display.channel.append(output);
                        needRefresh = true;
                    })
                    .catch(reason => {
                        Display.showError(reason.toString());
                    });
            }
        }

        if (needRefresh) {
            this.Refresh();
        }
    }

    public async QuietlyRevertChangelist(chnum: string): Promise<void> {
        const command = "revert";
        const args = "-c " + chnum + " //...";

        const output = await Utils.runCommand(
            this._workspaceUri,
            command,
            null,
            null,
            args
        );
        Display.updateEditor();
        Display.channel.append(output);
    }

    public async ShelveChangelist(
        input: SourceControlResourceGroup,
        revert?: boolean
    ): Promise<void> {
        const id = input.id;
        const chnum = id.substr(id.indexOf(":") + 1);

        if (chnum === "default") {
            throw new Error("Cannot shelve the default changelist");
        }

        const command = "shelve";
        const args = "-f -c " + chnum;

        try {
            await Utils.runCommand(this._workspaceUri, command, null, null, args);
            if (revert) {
                await this.QuietlyRevertChangelist(chnum);
            }
            Display.showMessage("Changelist shelved");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
        this.Refresh();
    }

    public async UnshelveChangelist(input: SourceControlResourceGroup): Promise<void> {
        const id = input.id;
        const chnum = id.substr(id.indexOf(":") + 1);

        if (chnum === "default") {
            throw new Error("Cannot unshelve the default changelist");
        }

        const command = "unshelve";
        const args = "-f -s " + chnum + " -c " + chnum;

        try {
            await Utils.runCommand(this._workspaceUri, command, null, null, args);
            this.Refresh();
            Display.showMessage("Changelist unshelved");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    public async DeleteShelvedChangelist(
        input: SourceControlResourceGroup
    ): Promise<void> {
        const id = input.id;
        const chnum = id.substr(id.indexOf(":") + 1);

        if (chnum === "default") {
            throw new Error("Cannot delete shelved files from the default changelist");
        }

        const message =
            "Are you sure you want to delete the shelved files from changelist " +
            chnum +
            "?";

        const yes = "Delete Shelved Files";
        const pick = await window.showWarningMessage(message, { modal: true }, yes);
        if (pick !== yes) {
            return;
        }

        const command = "shelve";
        const args = "-d -c " + chnum;

        try {
            await Utils.runCommand(this._workspaceUri, command, null, null, args);
            this.Refresh();
            Display.showMessage("Shelved files deleted");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    public async ShelveOrUnshelve(input: Resource): Promise<void> {
        if (input.isShelved) {
            const args = "-c " + input.change + " -s " + input.change;
            const command = "unshelve";
            await Utils.runCommand(
                this._workspaceUri,
                command,
                input.depotPath,
                null,
                args
            )
                .then(() => {
                    const args = "-d -c " + input.change;
                    Utils.runCommand(
                        this._workspaceUri,
                        "shelve",
                        input.depotPath,
                        null,
                        args
                    )
                        .then(output => {
                            Display.updateEditor();
                            Display.channel.append(output);

                            this.Refresh();
                        })
                        .catch(reason => {
                            Display.showImportantError(reason.toString());

                            this.Refresh();
                        });
                })
                .catch(reason => {
                    Display.showImportantError(reason.toString());
                });
        } else {
            const args = "-f -c " + input.change;
            const command = "shelve";
            await Utils.runCommand(
                this._workspaceUri,
                command,
                input.resourceUri,
                null,
                args
            )
                .then(() => {
                    this.Revert(input);
                })
                .catch(reason => {
                    Display.showImportantError(reason.toString());
                });
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

        const command = "shelve";
        const args = "-d -c " + input.change + ' "' + input.depotPath + '"';

        try {
            const ret = await Utils.runCommand(
                this._workspaceUri,
                command,
                null,
                null,
                args
            );
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
        const id = input.id;
        const chnum = id.substr(id.indexOf(":") + 1);
        if (chnum === "default") {
            throw new Error("The default changelist cannot fix a job");
        }

        const jobId = await this.requestJobId(chnum);
        if (jobId === undefined) {
            return;
        }

        const command = "fix";
        const args = "-c " + chnum + " " + jobId;

        try {
            await Utils.runCommand(this._workspaceUri, command, null, null, args);
            this.Refresh();
            Display.showMessage("Job " + jobId + " added");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    private async pickJobFromChangelist(chnum: string) {
        const allJobs = await this.getFixedJobs(chnum);

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
        const id = input.id;
        const chnum = id.substr(id.indexOf(":") + 1);
        if (chnum === "default") {
            throw new Error("The default changelist cannot fix a job");
        }

        const job = await this.pickJobFromChangelist(chnum);

        if (job === undefined) {
            return;
        }

        const jobId = job.label;
        const command = "fix";
        const args = "-c " + chnum + " -d " + jobId;

        try {
            await Utils.runCommand(this._workspaceUri, command, null, null, args);
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

        const loggedin = await Utils.isLoggedIn(this._workspaceUri);
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

        // TODO - ideally this should be a single command instead of many
        for (const resource of resources) {
            const file = Uri.file(resource.resourceUri.fsPath);
            const args = "-c " + chnum;

            Utils.runCommand(this._workspaceUri, "reopen", file, null, args)
                .then(output => {
                    Display.channel.append(output);
                    this.Refresh();
                })
                .catch(reason => {
                    Display.showImportantError(reason.toString());
                });
        }
    }

    private clean() {
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
        let pathToSync = null;
        let p4Dir = config.p4Dir ? config.p4Dir : this._workspaceConfig.pwdOverride;
        if (p4Dir && p4Dir !== "none") {
            p4Dir = Utils.normalize(p4Dir);
            if (!trailingSlash.exec(p4Dir)) {
                p4Dir += "/";
            }
            pathToSync = vscode.Uri.file(p4Dir + "...");
        }

        await Utils.runCommand(this._workspaceUri, "sync", pathToSync, null, "")
            .then(output => {
                Display.channel.append(output);
                this.Refresh();
            })
            .catch(reason => {
                Display.showImportantError(reason.toString());
            });
    }

    private async updateInfo(): Promise<void> {
        const resource = Uri.file(this._config.localDir);
        this._infos = Utils.processInfo(await Utils.getSimpleOutput(resource, "info"));
    }

    private async updateStatus(): Promise<void> {
        const loggedin = await Utils.isLoggedIn(this._workspaceUri);
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

        this._onDidChange.fire();
    }

    private getResourceForOpenFile(fstatInfo: FstatInfo): Resource | undefined {
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
        this._defaultGroup.model = this;
        this._defaultGroup.resourceStates = resources.filter(
            (resource): resource is Resource =>
                !!resource && resource.change === "default"
        );

        const groups = changelists.map(c => {
            const group = sc.createResourceGroup(
                "pending:" + c.chnum,
                "#" + c.chnum + ": " + c.description
            ) as ResourceGroup;
            group["model"] = this;
            group.resourceStates = resources.filter(
                (resource): resource is Resource =>
                    !!resource && resource.change === c.chnum.toString()
            );
            return group;
        });

        groups.forEach((group, i) => {
            this._pendingGroups.set(changelists[i].chnum, {
                description: changelists[i].description,
                group: group
            });
        });
    }

    private async getChanges(): Promise<ChangeInfo[]> {
        const pendingArgs = "-c " + this.clientName + " -s pending";
        const output: string = await Utils.runCommand(
            this._workspaceUri,
            "changes",
            null,
            null,
            pendingArgs
        );
        let changeNumbers = output.trim().split("\n");

        if (this._workspaceConfig.changelistOrder === "ascending") {
            changeNumbers = changeNumbers.reverse();
        }

        const changelists = this.filterIgnoredChangelists(
            changeNumbers
                .map(c => this.parseChangelistDescription(c))
                .filter((c): c is ChangeInfo => c !== undefined)
        );

        return changelists;
    }

    private filterIgnoredChangelists(changelists: ChangeInfo[]): ChangeInfo[] {
        const prefix = this._workspaceConfig.ignoredChangelistPrefix;
        if (prefix) {
            changelists = changelists.filter(c => !c.description.startsWith(prefix));
        }
        return changelists;
    }

    private parseChangelistDescription(value: string): ChangeInfo | undefined {
        // Change num on date by user@client [status] description
        const matches = new RegExp(
            /Change\s(\d+)\son\s(.+)\sby\s(.+)@(.+)\s\*(.+)\*\s\'(.*)\'/
        ).exec(value);

        if (matches) {
            const num = matches[1];
            // const date = matches[2];
            // const user = matches[3];
            // const client = matches[4];
            // const status = matches[5];
            const description = matches[6];

            const chnum: number = parseInt(num.toString());
            return { chnum, description };
        }
    }

    private async getAllShelvedResources(changes: ChangeInfo[]): Promise<Resource[]> {
        if (this._workspaceConfig.hideShelvedFiles) {
            return [];
        }
        const allFileInfo = await this.getDepotShelvedFilePaths(
            changes.map(c => c.chnum)
        );
        return this.getShelvedResources(allFileInfo);
    }

    private getResourceForShelvedFile(chnum: string, fstatInfo: FstatInfo) {
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

    private async getShelvedResources(files: ShelvedChangeInfo[]): Promise<Resource[]> {
        const proms = files.map(f =>
            this.getFstatInfoForFiles(f.paths, "-Or -Rs -e " + f.chnum)
        );
        const fstatInfo = await Promise.all(proms);

        return fstatInfo.reduce((all, cur, i) => {
            return all.concat(
                cur
                    .filter((f): f is FstatInfo => !!f)
                    .map(f =>
                        this.getResourceForShelvedFile(files[i].chnum.toString(), f)
                    )
            );
        }, [] as Resource[]);
    }

    private async getDepotOpenedResources(): Promise<Resource[]> {
        const depotOpenedFilePromises = this.getDepotOpenedFilePaths();
        const fstatInfo = await this.getFstatInfoForFiles(
            await depotOpenedFilePromises,
            "-Or"
        );
        return fstatInfo
            .filter((info): info is FstatInfo => !!info) // in case fstat doesn't have output for this file
            .map(info => this.getResourceForOpenFile(info))
            .filter((resource): resource is Resource => resource !== undefined); // for files out of workspace
    }

    private async getDepotOpenedFilePaths(): Promise<string[]> {
        const resource = Uri.file(this._config.localDir);
        let opened: string[] = [];
        try {
            const output = await Utils.getSimpleOutput(resource, "opened");
            opened = output.trim().split("\n");
        } catch (err) {
            // perforce writes to stderr if no files are opened.
            //console.log("ERROR: " + err);
        }

        const files: string[] = [];
        opened.forEach(open => {
            const matches = new RegExp(
                /(.+)#(\d+)\s-\s([\w\/]+)\s(default\schange|change\s\d+)\s\(([\w\+]+)\)/
            ).exec(open);
            if (matches) {
                files.push(matches[1]);
            }
        });

        return files;
    }

    private async getFixedJobs(chnum: string) {
        const resource = Uri.file(this._config.localDir);
        const output = await Utils.getSimpleOutput(resource, "describe -s " + chnum);

        type FixedJob = { id: string; description: string[] };

        const allLines = output.trim().split("\n");
        const startIndex = allLines.findIndex(line => line.startsWith("Jobs fixed ..."));
        if (startIndex >= 0) {
            const endIndex = allLines.findIndex(
                line => !line.startsWith("\t") && line.includes("files ...")
            );
            const subLines =
                endIndex > 0
                    ? allLines.slice(startIndex + 1, endIndex)
                    : allLines.slice(startIndex + 1);

            let curJob: FixedJob;
            const allJobs: FixedJob[] = [];
            subLines.forEach(line => {
                line = line.replace(/\r/g, "");
                if (!line.startsWith("\t")) {
                    const matches = new RegExp(/^(.*?) on/).exec(line);
                    if (matches) {
                        curJob = { id: matches[1], description: [] };
                        if (curJob) {
                            allJobs.push(curJob);
                        }
                    }
                } else if (curJob) {
                    curJob.description.push(line.slice(1));
                }
            });

            return allJobs;
        }

        return [];
    }

    private async getDepotShelvedFilePaths(
        chnums: number[]
    ): Promise<ShelvedChangeInfo[]> {
        if (chnums.length === 0) {
            return [];
        }
        const resource = Uri.file(this._config.localDir);
        const output = await Utils.getSimpleOutput(
            resource,
            "describe -Ss " + chnums.join(" ")
        );
        const shelved = output.trim().split("\n");
        if (shelved.length === 0) {
            return [];
        }

        const files: ShelvedChangeInfo[] = [];
        shelved.forEach(open => {
            const chMatch = new RegExp(/^Change (\d+) by/).exec(open);
            if (chMatch) {
                files.push({ chnum: parseInt(chMatch[1]), paths: [] });
            } else if (files.length > 0) {
                const matches = new RegExp(/(\.+)\ (.*)#(.*) (.*)/).exec(open);
                if (matches) {
                    files[files.length - 1].paths.push(matches[2]);
                }
            }
        });

        return files.filter(c => c.paths.length > 0);
    }

    private splitArray<T>(arr: T[], chunkSize: number): T[][] {
        const ret: T[][] = [];
        for (let i = 0; i < arr.length; i += chunkSize) {
            ret.push(arr.slice(i, i + chunkSize));
        }
        return ret;
    }

    private async getFstatInfoForFiles(
        files: string[],
        additionalParams?: string
    ): Promise<(FstatInfo | undefined)[]> {
        const promises = this.splitArray(
            files,
            this._workspaceConfig.maxFilePerCommand
        ).map(fs => this.getFstatInfoForChunk(fs, additionalParams));

        const result = await Promise.all(promises);

        return result.reduce((prev, cur) => prev.concat(cur), []);
    }

    private async getFstatInfoForChunk(
        files: string[],
        additionalParams?: string
    ): Promise<(FstatInfo | undefined)[]> {
        const resource = Uri.file(this._config.localDir);

        if (additionalParams === undefined) {
            additionalParams = "";
        }

        // a shelved file may write to stderr if it doesn't exist in the workspace - so don't complain for stderr
        const [fstatOutput] = await Utils.getOutputs(
            resource,
            `fstat ${additionalParams} "${files.join('" "')}"`
        );

        // Windows will have lines end with \r\n.
        // Each file has multiple lines of output separated by a blank line.
        // Splitting on \n\r?\n will find newlines followed immediately by a newline
        // which will split the output for each file.
        const fstatFiles = fstatOutput.trim().split(/\n\r?\n/);
        const all = fstatFiles.map(file => {
            const lines = file.split("\n");
            const lineMap: FstatInfo = { depotFile: "" };
            lines.forEach(line => {
                // ... Key Value
                const matches = new RegExp(/[.]{3} (\w+)[ ]*(.+)?/).exec(line);
                if (matches) {
                    // A key may not have a value (e.g. `isMapped`).
                    // Treat these as flags and map them to 'true'.
                    lineMap[matches[1]] = matches[2] ? matches[2] : "true";
                }
            });
            return lineMap;
        });

        // there may be gaps due to missing shelved files - map to the correct positions
        return files.map(file => all.find(fs => fs["depotFile"] === file));
    }
}
